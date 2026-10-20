# Audio Local Remoto

## 1. Requisitos
- Node.js 18 o superior.
- PC conectado por cable de audio a las bocinas.

## 2. Audios
Copia tus MP3 dentro de `public/audio/` con estos nombres:
- promo1.mp3
- promo2.mp3
- mensaje.mp3

Para subir anuncios o grabar tu voz desde el botón **Administrar anuncios** de la página principal, configura Supabase (sección 4) e inicia sesión con la contraseña de administrador. Los MP3 y las grabaciones deben ocupar hasta 50 MB y sus nombres no se pueden repetir en el bucket.

## 3. Instalar dependencias
```powershell
npm.cmd install
```

## 4. Configurar Supabase Storage y el administrador
La carga de anuncios desde el panel requiere un bucket de Supabase Storage. En Supabase, abre **Project Settings → API** y copia el **Project URL** y la clave secreta **service_role**. En **Storage**, crea o identifica el bucket que almacenará los audios. El bucket puede ser privado; el servidor sirve sus archivos al reproductor.

Crea el archivo local `.env` copiando la plantilla:
```powershell
Copy-Item .env.example .env
```
Abre `.env` y reemplaza los valores de ejemplo:
```env
SUPABASE_URL=https://TU-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU-CLAVE-SECRETA
SUPABASE_BUCKET=audios
SUPABASE_AUDIO_FOLDER=promos
ADMIN_PASSWORD=una-contraseña-segura
```
`SUPABASE_BUCKET` es el nombre del bucket, no el nombre del archivo. `SUPABASE_AUDIO_FOLDER` es opcional; bórrala o déjala vacía para guardar los archivos en la raíz del bucket. Nunca pongas la clave `service_role` en el navegador, la compartas ni subas el archivo `.env` al repositorio. La plantilla `.env.example` no contiene secretos.

Instala las dependencias e inicia el servidor desde la carpeta del proyecto:
```powershell
npm.cmd install
npm.cmd start
```
Inicia sesión desde **Administrar anuncios** para subir un MP3 o grabar un anuncio con el micrófono. Las grabaciones se guardan en el formato de audio compatible que proporcione el navegador y se suben al bucket de Supabase; habilita el permiso del micrófono y usa HTTPS cuando el sitio esté publicado. Los archivos deben ocupar hasta 50 MB. Desde la sesión de administrador también puedes borrar cada anuncio; al confirmar, el objeto se elimina del bucket de Supabase y de la lista. Si Supabase no está configurado, el panel deshabilita la carga e indica que falta el archivo `.env`; los archivos locales existentes en `public/audio` siguen disponibles para reproducción.

El acceso de administrador no estará disponible si no se configura `ADMIN_PASSWORD`.

## 5. Uso en la misma red
En el PC abre:
`http://localhost:3000/player.html`

En los móviles abre:
`http://IP-DEL-PC:3000/`

Para ver la IP del PC en Windows ejecuta `ipconfig` y usa la IPv4.

## 6. Internet
El archivo `render.yaml` deja listo el servicio para Render:
1. Publica el proyecto en un repositorio privado de GitHub. Confirma que `.env` y `node_modules` no estén incluidos; `.gitignore` los excluye.
2. En Render, crea un **Blueprint** y conecta ese repositorio. Render detecta `render.yaml` y configura el servicio Node.js.
3. Al crear el servicio, completa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` y `ADMIN_PASSWORD` con los valores de tu `.env`. No copies `.env` al repositorio. La carpeta de Storage ya está configurada como `promos`; cámbiala en `render.yaml` si tus archivos están en otra carpeta.
4. Cuando termine el despliegue, Render proporciona una URL HTTPS. En la computadora conectada a las bocinas, abre `https://TU-SERVICIO.onrender.com/player.html` y deja esa pestaña abierta. Entra a `https://TU-SERVICIO.onrender.com` desde los dispositivos de control.

El plan gratuito de Render puede dormir el servicio tras 15 minutos sin tráfico entrante y concede 750 horas gratuitas por mes, compartidas entre los servicios gratuitos del workspace. Mantener abierto el reproductor genera tráfico WebSocket y puede mantener el servicio activo mientras haya conexión, pero Render puede reiniciarlo y no garantiza disponibilidad 24/7. Al despertar, puede tardar alrededor de un minuto en arrancar. Para operación continua garantizada, se necesita un plan siempre activo; la computadora reproductora también debe permanecer encendida y sin suspensión. No expongas directamente el puerto 3000 del PC a Internet.

## Nota de navegador
Los navegadores pueden bloquear reproducción automática hasta que el usuario interactúa una vez con la página. En el PC reproductor, pulsa Play una vez si el navegador lo solicita.
