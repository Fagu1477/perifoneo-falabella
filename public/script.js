const socket = io();
const status = document.getElementById('status');
const audioList = document.getElementById('audio-list');
const adminPanel = document.getElementById('admin-panel');
const loginForm = document.getElementById('login-form');
const uploadForm = document.getElementById('upload-form');
const recordControls = document.getElementById('record-controls');
const recordButton = document.getElementById('record-audio');
const adminMessage = document.getElementById('admin-message');
let canDeleteAudios = false;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingError = false;
let recordingTimeout;

function updateUploadAvailability(supabaseConfigured) {
  uploadForm.querySelectorAll('input, button[type="submit"]').forEach(control => {
    control.disabled = !supabaseConfigured;
  });
  recordControls.querySelectorAll('input, button').forEach(control => {
    control.disabled = !supabaseConfigured;
  });
  if (!supabaseConfigured) {
    adminMessage.textContent = 'Configura Supabase en el archivo .env y reinicia el servidor para subir anuncios.';
  }
}

socket.on('connect', () => status.textContent = '🟢 Conectado');
socket.on('disconnect', () => status.textContent = '🔴 Sin conexión');

function addAudioButton(file) {
  if ([...audioList.querySelectorAll('[data-audio-file]')].some(item => item.dataset.audioFile === file)) return;
  const item = document.createElement('div');
  item.className = 'audio-item';
  item.dataset.audioFile = file;
  const playButton = document.createElement('button');
  playButton.className = 'play';
  playButton.dataset.file = file;
  playButton.textContent = `▶ ${file.replace(/\.(mp3|webm|ogg|m4a)$/i, '').replace(/[-_]/g, ' ').toUpperCase()}`;
  const deleteButton = document.createElement('button');
  deleteButton.className = 'delete-audio';
  deleteButton.type = 'button';
  deleteButton.dataset.deleteFile = file;
  deleteButton.textContent = '🗑️ Borrar';
  deleteButton.hidden = !canDeleteAudios;
  item.append(playButton, deleteButton);
  audioList.append(item);
}

async function loadAudios() {
  const response = await fetch('/api/audios');
  if (!response.ok) throw new Error('No se pudieron cargar los audios disponibles.');
  const files = await response.json();
  files.forEach(addAudioButton);
}

audioList.addEventListener('click', event => {
  const deleteButton = event.target.closest('[data-delete-file]');
  if (deleteButton) {
    deleteAudio(deleteButton);
    return;
  }
  const button = event.target.closest('[data-file]');
  if (button) socket.emit('command', { action: 'play', file: button.dataset.file });
});

async function deleteAudio(button) {
  const file = button.dataset.deleteFile;
  const title = file.replace(/\.(mp3|webm|ogg|m4a)$/i, '').replace(/[-_]/g, ' ');
  if (!window.confirm(`¿Borrar "${title}" de Supabase? Esta acción no se puede deshacer.`)) return;
  button.disabled = true;
  adminMessage.textContent = '';
  try {
    const response = await fetch(`/api/audios/${file.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo borrar el anuncio.');
    button.closest('[data-audio-file]').remove();
    adminMessage.textContent = 'Anuncio borrado de Supabase.';
  } catch (error) {
    button.disabled = false;
    adminMessage.textContent = error.message || 'No se pudo conectar con el servidor.';
  }
}

recordButton.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    recordButton.disabled = true;
    recordButton.textContent = 'Guardando grabación…';
    mediaRecorder.stop();
    return;
  }

  const title = document.getElementById('recording-title').value.trim();
  if (!title) {
    adminMessage.textContent = 'Escribe un nombre para la grabación.';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    adminMessage.textContent = 'Este navegador no admite grabar audio. Prueba con Chrome, Edge o Safari actualizado.';
    return;
  }

  adminMessage.textContent = '';
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const supportedTypes = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/webm',
      'audio/ogg'
    ];
    const mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      throw new Error('Este navegador no ofrece un formato de grabación compatible.');
    }
    recordingChunks = [];
    recordingError = false;
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener('error', () => {
      recordingError = true;
      adminMessage.textContent = 'Ocurrió un error al grabar el audio.';
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    });
    mediaRecorder.addEventListener('stop', async () => {
      window.clearTimeout(recordingTimeout);
      recordingTimeout = null;
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
      recordButton.disabled = true;
      document.getElementById('admin-logout').disabled = true;
      recordButton.textContent = 'Subiendo grabación…';
      try {
        if (recordingError) return;
        const recording = new Blob(recordingChunks, { type: mediaRecorder.mimeType });
        if (!recording.size) throw new Error('La grabación está vacía. Intenta grabar de nuevo.');
        if (recording.size > 50 * 1024 * 1024) {
          throw new Error('La grabación supera el límite de 50 MB.');
        }
        const response = await fetch('/api/recordings', {
          method: 'POST',
          headers: {
            'Content-Type': recording.type,
            'X-Audio-Name': encodeURIComponent(title)
          },
          body: recording
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar la grabación.');
        addAudioButton(result.file);
        document.getElementById('recording-title').value = '';
        adminMessage.textContent = 'Grabación guardada en Supabase y disponible para reproducir.';
      } catch (error) {
        adminMessage.textContent = error.message || 'No se pudo conectar con el servidor.';
      } finally {
        recordingChunks = [];
        mediaRecorder = null;
        recordButton.disabled = false;
        document.getElementById('admin-logout').disabled = false;
        recordButton.textContent = '🎙️ Grabar voz';
      }
    });
    mediaRecorder.start();
    document.getElementById('admin-logout').disabled = true;
    recordButton.textContent = '⏹ Detener y guardar';
    adminMessage.textContent = 'Grabando… pulsa “Detener y guardar” cuando termines.';
    recordingTimeout = window.setTimeout(() => {
      recordingTimeout = null;
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        adminMessage.textContent = 'Se alcanzó el límite de 10 minutos; guardando la grabación.';
        mediaRecorder.stop();
      }
    }, 10 * 60 * 1000);
  } catch (error) {
    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }
    adminMessage.textContent = error.name === 'NotAllowedError'
      ? 'No se concedió permiso para usar el micrófono.'
      : error.name === 'NotFoundError'
        ? 'No se encontró un micrófono en este dispositivo.'
        : error.message || 'No se pudo iniciar la grabación.';
    recordButton.textContent = '🎙️ Grabar voz';
    document.getElementById('admin-logout').disabled = false;
  }
});

document.getElementById('stop').onclick = () => socket.emit('command', { action: 'stop' });
loadAudios().catch(error => {
  adminMessage.textContent = error.message;
});

document.getElementById('admin-toggle').onclick = async () => {
  adminPanel.hidden = !adminPanel.hidden;
  if (!adminPanel.hidden) {
    try {
      const response = await fetch('/api/admin/session');
      const session = await response.json();
      const authenticated = response.ok && session.authenticated;
      canDeleteAudios = authenticated && session.supabaseConfigured;
      audioList.querySelectorAll('[data-delete-file]').forEach(button => {
        button.hidden = !canDeleteAudios;
      });
      loginForm.hidden = authenticated;
      uploadForm.hidden = !authenticated;
      recordControls.hidden = !authenticated;
      document.getElementById('admin-logout').hidden = !authenticated;
      if (authenticated) updateUploadAvailability(session.supabaseConfigured);
      else adminMessage.textContent = '';
    } catch {
      adminMessage.textContent = 'No se pudo verificar la sesión de administrador.';
    }
  }
};

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminMessage.textContent = '';
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: new FormData(loginForm).get('password') })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo iniciar sesión.');
    loginForm.reset();
    loginForm.hidden = true;
    uploadForm.hidden = false;
    recordControls.hidden = false;
    document.getElementById('admin-logout').hidden = false;
    canDeleteAudios = result.supabaseConfigured;
    audioList.querySelectorAll('[data-delete-file]').forEach(button => {
      button.hidden = !canDeleteAudios;
    });
    updateUploadAvailability(result.supabaseConfigured);
    if (result.supabaseConfigured) adminMessage.textContent = 'Sesión de administrador iniciada.';
  } catch (error) {
    adminMessage.textContent = error.message || 'No se pudo conectar con el servidor.';
  }
});

uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminMessage.textContent = '';
  const file = document.getElementById('audio-file').files[0];
  const title = document.getElementById('audio-title').value.trim();
  if (!file || !file.name.toLowerCase().endsWith('.mp3')) {
    adminMessage.textContent = 'Selecciona un archivo con extensión .mp3.';
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    adminMessage.textContent = 'El archivo supera el límite de 50 MB.';
    return;
  }
  try {
    const response = await fetch('/api/audios', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Audio-Name': encodeURIComponent(title)
      },
      body: file
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo añadir el audio.');
    addAudioButton(result.file);
    uploadForm.reset();
    adminMessage.textContent = 'Audio añadido. Ya está disponible en la lista.';
  } catch (error) {
    adminMessage.textContent = error.message || 'No se pudo conectar con el servidor.';
  }
});

document.getElementById('admin-logout').onclick = async () => {
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST' });
    if (!response.ok) throw new Error('No se pudo cerrar la sesión.');
    loginForm.hidden = false;
    uploadForm.hidden = true;
    recordControls.hidden = true;
    document.getElementById('admin-logout').hidden = true;
    canDeleteAudios = false;
    audioList.querySelectorAll('[data-delete-file]').forEach(button => {
      button.hidden = true;
    });
    adminMessage.textContent = 'Sesión de administrador cerrada.';
  } catch (error) {
    adminMessage.textContent = error.message || 'No se pudo conectar con el servidor.';
  }
};
