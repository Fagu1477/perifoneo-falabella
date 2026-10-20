require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);
const audioDirectory = path.join(__dirname, 'public', 'audio');
const adminSessions = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseBucket = process.env.SUPABASE_BUCKET || '';
const supabaseFolder = (process.env.SUPABASE_AUDIO_FOLDER || '').split('/')
  .filter(Boolean)
  .join('/');
fs.mkdirSync(audioDirectory, { recursive: true });
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getSupabaseConfig() {
  const configured = [supabaseUrl, supabaseServiceKey, supabaseBucket].filter(Boolean).length;
  if (!configured) return null;
  if (configured !== 3) {
    throw new Error('Configura SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_BUCKET.');
  }
  return {
    url: supabaseUrl,
    serviceKey: supabaseServiceKey,
    bucket: supabaseBucket,
    folder: supabaseFolder
  };
}

function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseServiceKey && supabaseBucket);
}

function getStorageObjectPath(config, file) {
  if (!config.folder || file === config.folder || file.startsWith(`${config.folder}/`)) {
    return file;
  }
  return `${config.folder}/${file}`;
}

function isValidAudioPath(file) {
  return typeof file === 'string' &&
    file.length <= 1024 &&
    /\.(mp3|webm|ogg|m4a)$/i.test(file) &&
    file.split('/').every(part =>
      part.length > 0 &&
      part !== '.' &&
      part !== '..' &&
      !/[\\\u0000-\u001f\u007f]/.test(part)
    );
}

function getAudioContentType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.mp3': 'audio/mpeg',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4'
  }[extension];
}

async function supabaseRequest(config, endpoint, options = {}) {
  const response = await fetch(`${config.url}/storage/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      ...options.headers
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Supabase respondió ${response.status}${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

function getSessionToken(req) {
  const cookie = req.headers.cookie || '';
  const sessionCookie = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('admin_session='));
  const token = sessionCookie ? sessionCookie.slice('admin_session='.length) : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return res.status(401).json({ error: 'Inicia sesión como administrador para continuar.' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return res.status(503).json({ error: 'El administrador no está configurado. Define ADMIN_PASSWORD y reinicia el servidor.' });
  }
  const submittedPassword = typeof req.body.password === 'string' ? req.body.password : '';
  const expected = Buffer.from(adminPassword);
  const submitted = Buffer.from(submittedPassword);
  if (expected.length !== submitted.length || !crypto.timingSafeEqual(expected, submitted)) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + sessionDuration);
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: sessionDuration,
    path: '/'
  });
  res.json({ ok: true, supabaseConfigured: isSupabaseConfigured() });
});

app.get('/api/admin/session', (req, res) => {
  const token = getSessionToken(req);
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, supabaseConfigured: isSupabaseConfigured() });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  adminSessions.delete(getSessionToken(req));
  res.clearCookie('admin_session', { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
  res.json({ ok: true });
});

app.get('/api/audios', async (req, res) => {
  try {
    const config = getSupabaseConfig();
    if (config) {
      const response = await supabaseRequest(config, `object/list/${encodeURIComponent(config.bucket)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix: config.folder,
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        })
      });
      const entries = await response.json();
      const files = entries
        .filter(entry => typeof entry.name === 'string' && /\.(mp3|webm|ogg|m4a)$/i.test(entry.name))
        .map(entry => getStorageObjectPath(config, entry.name))
        .sort((a, b) => a.localeCompare(b));
      return res.json(files);
    }
    const files = await fs.promises.readdir(audioDirectory);
    res.json(files.filter(file => /\.(mp3|webm|ogg|m4a)$/i.test(file)).sort((a, b) => a.localeCompare(b)));
  } catch (error) {
    console.error('No se pudieron listar los audios:', error);
    res.status(502).json({ error: `No se pudieron cargar los audios: ${error.message}` });
  }
});

app.delete('/api/audios/*', requireAdmin, async (req, res) => {
  const file = req.params[0];
  if (!isValidAudioPath(file)) {
    return res.status(400).json({ error: 'La ruta del anuncio no es válida.' });
  }
  try {
    const config = getSupabaseConfig();
    if (!config) {
      return res.status(503).json({
        error: 'Supabase no está configurado. No se puede borrar el anuncio del almacenamiento.'
      });
    }
    const objectPath = getStorageObjectPath(config, file)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    await supabaseRequest(config, `object/${encodeURIComponent(config.bucket)}/${objectPath}`, {
      method: 'DELETE'
    });
    res.json({ ok: true, file });
  } catch (error) {
    console.error('No se pudo borrar el anuncio:', error);
    const status = error.status === 404 ? 404 : 502;
    res.status(status).json({
      error: status === 404
        ? 'El anuncio no existe en el almacenamiento de Supabase.'
        : `No se pudo borrar el anuncio de Supabase: ${error.message}`
    });
  }
});

app.get('/api/audios/*', async (req, res) => {
  const file = req.params[0];
  if (!isValidAudioPath(file)) {
    return res.status(400).json({ error: 'La ruta del audio no es válida.' });
  }
  try {
    const config = getSupabaseConfig();
    if (!config) {
      return res.sendFile(path.join(audioDirectory, file), error => {
        if (error && !res.headersSent) res.status(error.statusCode || 404).json({ error: 'No se encontró el audio.' });
      });
    }
    const objectPath = getStorageObjectPath(config, file)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    const response = await supabaseRequest(config, `object/${encodeURIComponent(config.bucket)}/${objectPath}`, {
      headers: req.headers.range ? { Range: req.headers.range } : {}
    });
    res.status(response.status);
    res.set('Content-Type', getAudioContentType(file));
    res.set('Cache-Control', 'private, max-age=300');
    for (const header of ['accept-ranges', 'content-range', 'content-length']) {
      const value = response.headers.get(header);
      if (value) res.set(header, value);
    }
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    console.error('No se pudo obtener el audio:', error);
    if (!res.headersSent) {
      const status = error.status === 404 ? 404 : 502;
      res.status(status).json({ error: status === 404 ? 'No se encontró el audio en Supabase.' : 'No se pudo obtener el audio desde Supabase.' });
    }
  }
});

app.post('/api/recordings', requireAdmin, express.raw({
  type: ['audio/webm', 'audio/ogg', 'audio/mp4'],
  limit: '50mb'
}), async (req, res) => {
  const audioName = req.get('X-Audio-Name');
  let title;
  try {
    title = decodeURIComponent(audioName || '');
  } catch {
    return res.status(400).json({ error: 'El nombre del anuncio no es válido.' });
  }
  if (!title.trim() || title.length > 80) {
    return res.status(400).json({ error: 'Escribe un nombre de entre 1 y 80 caracteres.' });
  }
  const safeName = title.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!safeName) {
    return res.status(400).json({ error: 'El nombre debe contener letras o números.' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'La grabación está vacía. Graba tu voz antes de guardarla.' });
  }
  const contentType = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const extension = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a'
  }[contentType];
  if (!extension) {
    return res.status(415).json({ error: 'El navegador generó un formato de grabación no compatible.' });
  }
  try {
    const config = getSupabaseConfig();
    if (!config) {
      return res.status(503).json({
        error: 'Supabase no está configurado. Define sus variables en .env y reinicia el servidor.'
      });
    }
    const file = `${safeName}.${extension}`;
    const objectPath = getStorageObjectPath(config, file)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    await supabaseRequest(config, `object/${encodeURIComponent(config.bucket)}/${objectPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'x-upsert': 'false'
      },
      body: req.body
    });
    res.status(201).json({ file: getStorageObjectPath(config, file) });
  } catch (error) {
    if (error.status === 400 && /already exists|duplicate/i.test(error.message)) {
      return res.status(409).json({ error: 'Ya existe un anuncio con ese nombre. Elige otro nombre.' });
    }
    console.error('No se pudo guardar la grabación:', error);
    res.status(502).json({ error: `No se pudo guardar la grabación en Supabase: ${error.message}` });
  }
});

app.post('/api/audios', requireAdmin, express.raw({
  type: ['audio/mpeg', 'audio/mp3', 'application/octet-stream'],
  limit: '50mb'
}), async (req, res) => {
  const audioName = req.get('X-Audio-Name');
  let title;
  try {
    title = decodeURIComponent(audioName || '');
  } catch {
    return res.status(400).json({ error: 'El nombre del audio no es válido.' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Selecciona un archivo MP3 que no esté vacío.' });
  }
  const hasId3Tag = req.body.subarray(0, 3).toString() === 'ID3';
  const hasMpegFrame = req.body.subarray(0, 4096).some((byte, index, data) => {
    if (byte !== 0xff || index + 1 >= data.length || (data[index + 1] & 0xe0) !== 0xe0) return false;
    const version = (data[index + 1] >> 3) & 0x03;
    const layer = (data[index + 1] >> 1) & 0x03;
    const bitrate = (data[index + 2] >> 4) & 0x0f;
    const sampleRate = (data[index + 2] >> 2) & 0x03;
    return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3;
  });
  if (!hasId3Tag && !hasMpegFrame) {
    return res.status(400).json({ error: 'El archivo seleccionado no parece ser un MP3 válido.' });
  }
  if (!title.trim() || title.length > 80) {
    return res.status(400).json({ error: 'Escribe un nombre de entre 1 y 80 caracteres.' });
  }
  const safeName = title.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!safeName) {
    return res.status(400).json({ error: 'El nombre debe contener letras o números.' });
  }
  try {
    const config = getSupabaseConfig();
    if (!config) {
      return res.status(503).json({
        error: 'Supabase no está configurado. Define SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_BUCKET en el archivo .env y reinicia el servidor.'
      });
    }
    const file = `${safeName}.mp3`;
    const objectPath = getStorageObjectPath(config, file)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    await supabaseRequest(config, `object/${encodeURIComponent(config.bucket)}/${objectPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/mpeg',
        'x-upsert': 'false'
      },
      body: req.body
    });
    res.status(201).json({ file: getStorageObjectPath(config, file) });
  } catch (error) {
    if (error.code === 'EEXIST' || (error.status === 400 && /already exists|duplicate/i.test(error.message))) {
      return res.status(409).json({ error: 'Ya existe un audio con ese nombre. Elige otro nombre.' });
    }
    console.error('No se pudo guardar el audio:', error);
    res.status(error.message.startsWith('Configura SUPABASE_') ? 503 : 502).json({ error: `No se pudo guardar el audio en Supabase: ${error.message}` });
  }
});

io.on('connection', socket => {
  socket.on('command', cmd => {
    if (!cmd || !['play','stop'].includes(cmd.action)) return;
    if (cmd.action === 'play' && !isValidAudioPath(cmd.file)) return;
    io.to('players').emit('command', cmd);
  });
  socket.on('register-player', () => socket.join('players'));
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El archivo supera el límite de 50 MB.' });
  }
  console.error('Error al procesar la solicitud:', error);
  res.status(400).json({ error: 'No se pudo procesar la solicitud.' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Audio Local listo en puerto ${PORT}`));
