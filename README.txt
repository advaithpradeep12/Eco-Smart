SMART ECO CAMPUS — RENDER DEPLOYMENT

Do you need to install Node.js on your own computer?
No, not to deploy this project on Render. Render runs the Node.js backend for you.
You only need Node.js locally if you want to test/run the site on your own computer.

DEPLOY STEPS

1. Extract this ZIP.
2. Put the files in a GitHub repository:
   - index.html
   - server.js
   - package.json
   - render.yaml
3. On Render, choose New > Blueprint (or create a Web Service) and connect that GitHub repository.
   If using Blueprint, Render reads render.yaml.
4. In the Render service dashboard, open Environment and add:
   Key: ROBOFLOW_API_KEY
   Value: your Roboflow API key
   Save changes and deploy/redeploy.
5. Open the Render URL after deployment finishes.

SECURITY
- Do not add the Roboflow API key to index.html, GitHub, or this ZIP.
- Add it only as the ROBOFLOW_API_KEY environment variable in Render.
- Keep the repository private if it contains other school project materials.
- This backend currently exposes the uniform-check endpoint publicly. For a real school deployment, add user authentication, request limits, and appropriate consent/privacy safeguards before collecting student images.

NOTES
- This is a Node.js backend service; Render runs it with Node.js 18+.
- The website and /api/uniform-check endpoint are served from the same origin to avoid browser CORS issues.
- Render free-tier availability, sleep behavior, and limits may change; check Render's current plan details.
