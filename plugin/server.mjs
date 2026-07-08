#!/usr/bin/env node
// Alita Glasses API Proxy
// Lightweight HTTP server for the Even Hub plugin
// Runs on Mac, plugin connects over LAN

import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 9191;
const HOST = '0.0.0.0';
const HOME = os.homedir();
const SESSION_DB = path.join(HOME, '.hermes', 'sessions.db');

// ── Smart Reply Generation ──────────────────────────────────────

function generateSmartReplies(userMessage, assistantResponse) {
  const lower = assistantResponse.toLowerCase();
  const userLower = (userMessage || '').toLowerCase();
  const replies = [];

  if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('event')) {
    replies.push('What\'s after that?', 'Reschedule it', 'Add a reminder');
  }
  if (lower.includes('weather') || lower.includes('temperature')) {
    replies.push('What about tomorrow?', 'Weekly forecast', 'Bring umbrella?');
  }
  if (lower.includes('time') || lower.includes('date') || lower.includes('today')) {
    replies.push('What\'s on my calendar?', 'Set a reminder', 'What day is tomorrow?');
  }
  if (lower.includes('email') || lower.includes('message') || lower.includes('mail')) {
    replies.push('Reply to it', 'Read next one', 'Mark as read');
  }
  if (lower.includes('remind') || lower.includes('todo') || lower.includes('task')) {
    replies.push('Show all tasks', 'Add another', 'Mark as done');
  }
  if (lower.includes('search') || lower.includes('found') || lower.includes('result')) {
    replies.push('Tell me more', 'Open it', 'Search again');
  }
  if (lower.includes('error') || lower.includes('failed') || lower.includes('sorry')) {
    replies.push('Try again', 'Explain error', 'Skip it');
  }
  if (userLower.includes('help') || userLower.includes('what can')) {
    replies.push('Check my calendar', 'Weather forecast', 'Read my emails');
  }

  const generic = [
    'Tell me more', 'Explain that', 'What\'s next?',
    'Thanks', 'Skip', 'Do that', 'Why?',
    'Show me', 'Continue', 'Go back',
  ];

  const seen = new Set(replies);
  for (const g of generic) {
    if (replies.length >= 5) break;
    if (!seen.has(g)) { replies.push(g); seen.add(g); }
  }

  return replies.slice(0, 5);
}

// ── Session Context (SQLite) ─────────────────────────────────────

function queryStateDb(sql) {
  try {
    const dbPath = path.join(HOME, '.hermes', 'state.db');
    const cmd = `sqlite3 -json ${JSON.stringify(dbPath)} ${JSON.stringify(sql)} 2>/dev/null`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
    return JSON.parse(output || '[]');
  } catch {
    return [];
  }
}

function getLastSessionTopic() {
  const rows = queryStateDb(
    "SELECT m.content FROM messages m WHERE m.session_id = " +
    "(SELECT id FROM sessions WHERE source != 'subagent' AND archived = 0 ORDER BY started_at DESC LIMIT 1) " +
    "AND m.role = 'user' AND m.content IS NOT NULL AND m.content != '' ORDER BY m.timestamp DESC LIMIT 1"
  );
  if (rows.length > 0) {
    return 'Last: ' + rows[0].content.slice(0, 80);
  }
  return null;
}

function getSessionContext() {
  const rows = queryStateDb(
    "SELECT m.role, m.content FROM messages m WHERE m.session_id = " +
    "(SELECT id FROM sessions WHERE source != 'subagent' AND archived = 0 ORDER BY started_at DESC LIMIT 1) " +
    "AND m.role IN ('user', 'assistant') AND m.content IS NOT NULL AND m.content != '' ORDER BY m.timestamp DESC LIMIT 8"
  );
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

// ── Hermes CLI Wrapper ──────────────────────────────────────

function callHermes(message, history) {
  return new Promise((resolve, reject) => {
    // Prepend glasses-optimized system hint
    const glassesHint = '[Respond in 1-3 short sentences max. Be concise — this displays on smart glasses with a 576x288px screen. No markdown, no lists, no code blocks. Plain text only.]';

    let contextPrompt = glassesHint + '\n\n' + message;
    if (history && history.length > 1) {
      const recentHistory = history.slice(-6, -1);
      const context = recentHistory.map(h =>
        `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
      ).join('\n');
      contextPrompt = glassesHint + '\n\nPrevious conversation:\n' + context + '\n\nUser: ' + message;
    }

    const child = spawn('hermes', ['chat', '-q', contextPrompt, '-Q', '-t', 'hermes-cli'], {
      env: { ...process.env, TERM: 'dumb', SSL_CERT_FILE: '/private/etc/ssl/cert.pem' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());

    child.on('close', code => {
      if (code === 0 || stdout.trim()) {
        resolve(stdout.trim() || '(no response)');
      } else {
        reject(new Error(`hermes exited ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    child.on('error', reject);

    setTimeout(() => {
      child.kill('SIGTERM');
      resolve(stdout.trim() || '(timeout — try again)');
    }, 30000);
  });
}

// ── Transcription ──────────────────────────────────────────────

async function transcribeAudio(audioBuffer) {
  // TODO: Whisper integration
  return { text: '', error: 'Transcription not yet implemented' };
}

// ── HTTP Server ──────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve static files (icon.png, etc.)
  if (req.method === 'GET' && req.url === '/icon.png') {
    try {
      const iconPath = path.join(__dirname, 'icon.png');
      const iconData = fs.readFileSync(iconPath);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(iconData);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // Health
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'alita-glasses-api' }));
    return;
  }

  // Session info (for start screen)
  if (req.method === 'GET' && req.url === '/session-info') {
    const lastTopic = getLastSessionTopic();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lastTopic }));
    return;
  }

  // Continue session (load previous context)
  if (req.method === 'GET' && req.url === '/continue') {
    try {
      const history = getSessionContext();
      let summary = 'Continuing from where we left off. What\'s next?';
      let replies = null;

      if (history.length > 0) {
        // Get a summary from hermes about what we were doing
        const lastMessages = history.slice(-4);
        const context = lastMessages.map(m =>
          `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n');

        try {
          const summaryResponse = await callHermes(
            `Briefly summarize what we were just discussing in 1-2 sentences. Context:\n${context}`,
            []
          );
          summary = summaryResponse;
          replies = generateSmartReplies('', summary);
        } catch {
          // Use raw context
          const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
          if (lastAssistant) {
            summary = lastAssistant.content.slice(0, 200);
            replies = generateSmartReplies('', summary);
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ history, summary, replies }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ history: [], summary: 'Ready. What\'s next?', replies: null }));
    }
    return;
  }

  // Chat
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, history } = JSON.parse(body);
        console.log(`[chat] ${message.slice(0, 80)}`);

        const response = await callHermes(message, history);
        const replies = generateSmartReplies(message, response);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response, replies }));
      } catch (err) {
        console.error('[chat] error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Transcribe
  if (req.method === 'POST' && req.url === '/transcribe') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const audioBuffer = Buffer.concat(chunks);
        console.log(`[transcribe] ${audioBuffer.length} bytes`);
        const result = await transcribeAudio(audioBuffer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`Alita Glasses API running on http://${HOST}:${PORT}`);
  console.log(`Plugin should connect to: http://192.168.0.203:${PORT}`);
});
