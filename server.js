
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const STAFF_REVIEW_PASSWORD = process.env.STAFF_REVIEW_PASSWORD;

const WORKFLOW_URL =
  "https://serverless.roboflow.com/advaiths-workspace-wvko1/workflows/full-body-uniform-check-1795538335596";

// Temporary storage: reviews disappear when the server restarts.
const reviews = [];

const sessions = new Map();
const loginAttempts = new Map();

const SESSION_DURATION = 8 * 60 * 60 * 1000;
const MAX_REVIEWS = 250;
const MAX_BODY_SIZE = 15 * 1024 * 1024;

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;

      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const parts = cookie.trim().split("=");

    if (parts[0] === name) {
      return parts.slice(1).join("=");
    }
  }

  return null;
}

function isAuthenticated(req) {
  const token = getCookie(req, "staff_session");

  if (!token) return false;

  const expiry = sessions.get(token);

  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function requireStaff(req, res) {
  if (!isAuthenticated(req)) {
    send(res, 401, {
      error: "Staff login required"
    });

    return false;
  }

  return true;
}

function safeCompare(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  if (first.length !== second.length) return false;

  return crypto.timingSafeEqual(first, second);
}

function getImage(body) {
  return (
    body.image ||
    body.imageData ||
    body.image_data ||
    body.frame ||
    body.photo ||
    null
  );
}

function serveFile(res, filename, contentType) {
  const filePath = path.join(__dirname, filename);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("File not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });

  fs.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Main website
  if (req.method === "GET" && pathname === "/") {
    return serveFile(
      res,
      "index.html",
      "text/html; charset=utf-8"
    );
  }

  // Staff page
  if (req.method === "GET" && pathname === "/staff") {
    return serveFile(
      res,
      "staff.html",
      "text/html; charset=utf-8"
    );
  }

  // Roboflow workflow
  if (
    req.method === "POST" &&
    pathname === "/api/uniform-check"
  ) {
    if (!ROBOFLOW_API_KEY) {
      return send(res, 500, {
        error: "ROBOFLOW_API_KEY is missing from Render environment variables"
      });
    }

    try {
      const body = await readBody(req);

      // Send the API key in the workflow JSON body.
      body.api_key = ROBOFLOW_API_KEY;

      const response = await fetch(WORKFLOW_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const result = await response.text();

      console.log(
        "Roboflow response status:",
        response.status
      );

      // Forward Roboflow's response to the website.
      res.writeHead(response.status, {
        "Content-Type":
          response.headers.get("content-type") ||
          "application/json",
        "Cache-Control": "no-store"
      });

      return res.end(result);

    } catch (error) {
      console.error(
        "Roboflow workflow error:",
        error.message
      );

      return send(res, 500, {
        error: "Could not connect to the uniform checking service"
      });
    }
  }

  // Staff login
  if (
    req.method === "POST" &&
    pathname === "/api/staff/login"
  ) {
    if (!STAFF_REVIEW_PASSWORD) {
      return send(res, 500, {
        error: "Staff password has not been configured"
      });
    }

    const ip = req.socket.remoteAddress || "unknown";
    const attempts = loginAttempts.get(ip);

    if (attempts && attempts.blockedUntil > Date.now()) {
      return send(res, 429, {
        error: "Too many attempts. Please try again later."
      });
    }

    try {
      const body = await readBody(req);

      if (
        !safeCompare(
          body.password || "",
          STAFF_REVIEW_PASSWORD
        )
      ) {
        const current = loginAttempts.get(ip) || {
          count: 0,
          blockedUntil: 0
        };

        current.count++;

        if (current.count >= 8) {
          current.blockedUntil =
            Date.now() + 5 * 60 * 1000;

          current.count = 0;
        }

        loginAttempts.set(ip, current);

        return send(res, 401, {
          error: "Incorrect password"
        });
      }

      loginAttempts.delete(ip);

      const token = crypto.randomBytes(32).toString("hex");

      sessions.set(
        token,
        Date.now() + SESSION_DURATION
      );

      const secure =
        process.env.NODE_ENV === "production"
          ? "; Secure"
          : "";

      return send(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie":
            `staff_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}${secure}`
        }
      );

    } catch {
      return send(res, 400, {
        error: "Invalid request"
      });
    }
  }

  // Check staff session
  if (
    req.method === "GET" &&
    pathname === "/api/staff/session"
  ) {
    return send(res, 200, {
      authenticated: isAuthenticated(req)
    });
  }

  // Logout
  if (
    req.method === "POST" &&
    pathname === "/api/staff/logout"
  ) {
    const token = getCookie(req, "staff_session");

    if (token) {
      sessions.delete(token);
    }

    return send(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie":
          "staff_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
      }
    );
  }

  // Get review queue
  if (
    req.method === "GET" &&
    pathname === "/api/staff/reviews"
  ) {
    if (!requireStaff(req, res)) return;

    return send(res, 200, { reviews });
  }

  // Submit a review
  if (
    req.method === "POST" &&
    pathname === "/api/staff/reviews"
  ) {
    try {
      const body = await readBody(req);
      const image = getImage(body);

      if (!image || typeof image !== "string") {
        return send(res, 400, {
          error: "A review image is required"
        });
      }

      const review = {
        id: crypto.randomUUID(),
        image,
        missingItems:
          body.missingItems || body.missing || [],
        detectedItems:
          body.detectedItems || body.detected || [],
        createdAt: new Date().toISOString(),
        reviewed: false
      };

      reviews.unshift(review);

      if (reviews.length > MAX_REVIEWS) {
        reviews.length = MAX_REVIEWS;
      }

      return send(res, 201, {
        ok: true,
        id: review.id
      });

    } catch (error) {
      console.error("Review error:", error.message);

      return send(res, 500, {
        error: "Could not save the review"
      });
    }
  }

  // Update or delete review
  if (
    pathname.startsWith("/api/staff/reviews/") &&
    (
      req.method === "PATCH" ||
      req.method === "DELETE"
    )
  ) {
    if (!requireStaff(req, res)) return;

    const id = decodeURIComponent(
      pathname.substring(
        "/api/staff/reviews/".length
      )
    );

    const index = reviews.findIndex(
      review => review.id === id
    );

    if (index === -1) {
      return send(res, 404, {
        error: "Review not found"
      });
    }

    if (req.method === "DELETE") {
      reviews.splice(index, 1);

      return send(res, 200, {
        ok: true
      });
    }

    try {
      const body = await readBody(req);

      if (typeof body.reviewed === "boolean") {
        reviews[index].reviewed = body.reviewed;
      }

      return send(res, 200, {
        ok: true,
        review: reviews[index]
      });

    } catch {
      return send(res, 400, {
        error: "Invalid request"
      });
    }
  }

  return send(res, 404, {
    error: "Not found"
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error("Server error:", error.message);

    if (!res.headersSent) {
      send(res, 500, {
        error: "Internal server error"
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(
    `Smart Eco Campus server running on port ${PORT}`
  );
});
