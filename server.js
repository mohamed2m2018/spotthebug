const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

// Initialize the Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Attach WebSocket server for Gemini Live proxy with noServer to avoid breaking Next.js HMR
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const parsedUrl = parse(req.url, true);
    if (parsedUrl.pathname === '/api/voice') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // If it's not /api/voice, we let Next.js handle the upgrade (e.g., for /_next/webpack-hmr)
  });

  wss.on('connection', (ws, req) => {
    console.log('Client connected to voice proxy');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is missing in env variables');
      ws.send(JSON.stringify({ error: 'Server configuration error' }));
      ws.close();
      return;
    }

    // Connect securely to Gemini Live API from the server
    const host = 'generativelanguage.googleapis.com';
    const wsUrl = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    const geminiWs = new WebSocket(wsUrl);

    geminiWs.on('open', () => {
      console.log('Connected to Gemini Live API');
      
      // Send initial setup config (audio output only, choose voice)
      const setupMessage = {
        setup: {
          model: 'models/gemini-2.5-flash', // Latest flash model
          systemInstruction: {
            parts: [{ 
              text: "You are SpotTheBug, an AI code review coach. You are patient, supportive, and guide the user to find bugs via voice conversation. Never just give the answer right away."
            }]
          },
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Aoede" // Friendly female voice, can also choose Puck, Charon, etc.
                }
              }
            }
          }
        }
      };
      geminiWs.send(JSON.stringify(setupMessage));
    });

    // Relay messages Gemini -> Client
    geminiWs.on('message', (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });

    // Relay messages Client -> Gemini
    ws.on('message', (data) => {
      if (geminiWs.readyState === geminiWs.OPEN) {
        geminiWs.send(data);
      }
    });

    // Handle closures and errors
    geminiWs.on('close', () => {
      console.log('Gemini WS closed');
      ws.close();
    });

    geminiWs.on('error', (err) => {
      console.error('Gemini WS error:', err);
      ws.close();
    });

    ws.on('close', () => {
      console.log('Client WS closed');
      geminiWs.close();
    });

    ws.on('error', (err) => {
      console.error('Client WS error:', err);
      geminiWs.close();
    });
  });

  server.once('error', (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Secure WebSocket proxy active on ws://${hostname}:${port}/api/voice`);
  });
});
