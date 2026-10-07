# 🍦 Checklist Heladería

App web para el celular: cada trabajador ve y marca las tareas de **su turno**, y administración ve el avance **en tiempo real**, recibe **avisos** y obtiene **reportes**.

## Qué hace

**Para el equipo (desde el celular)**
- Elige su nombre y entra con un PIN de 4 dígitos.
- Ve solo las tareas de su turno de hoy (Mañana, Tarde, Día completo…), separadas en Apertura / Durante el turno / Tarea especial del día / Cierre.
- Marca cada tarea al hacerla (queda registrada la hora).
- Ve los **pendientes de turnos anteriores** (de hoy o de ayer) y puede marcarlos si los hace: **administración recibe un aviso**.
- Presiona “Terminar turno”. Si quedan tareas sin marcar, administración recibe un aviso.

**Para administración**
- **En vivo:** avance de cada turno de hoy, estado (sin iniciar / en curso / terminado / fuera de horario), hora de cada tarea y avisos.
- **Turnos:** planilla semanal para asignar el turno de cada persona cada día, con la opción de copiar la semana anterior.
- **Reportes:** hoy, ayer, esta semana, semana pasada, este mes o las fechas que elijas. Incluye el % de cumplimiento por persona y por día, las tareas no hechas, las tareas que más se olvidan y quién cubrió a quién. Se puede descargar en Excel (CSV).
- **Tareas:** agregar, editar o desactivar tareas, y elegir qué días aplican.
- **Equipo:** agregar personas con su PIN y compartir el link de la app.
- **Ajustes:** activar notificaciones, cambiar el PIN de administración y descargar un respaldo.

PIN inicial de administración: **1234** (cámbialo en Ajustes).

---

## Paso 1 – Probar en modo demo (sin configurar nada)

Si `js/config.js` está vacío, la app funciona en **modo demo**: los datos quedan solo en el dispositivo donde se abre. Sirve para conocerla, pero **no comparte datos entre celulares**.

## Paso 2 – Conectar Firebase (gratis) para compartir datos en tiempo real

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google → **Crear proyecto** (puedes desactivar Google Analytics).
2. En el menú **Compilación → Firestore Database** → **Crear base de datos** → elige la ubicación `southamerica-east1` (São Paulo) → modo **producción**.
3. En la pestaña **Reglas** de Firestore, borra lo que haya, pega el contenido del archivo `firestore.rules` de este repositorio y presiona **Publicar**.
4. En **Compilación → Authentication** → **Comenzar** → pestaña **Sign-in method** → activa **Anónimo**.
5. En el engranaje ⚙️ **Configuración del proyecto** → sección “Tus apps” → ícono **`</>`** (Web) → ponle un nombre → **Registrar app**. Firebase te mostrará un bloque `firebaseConfig = { apiKey: ..., ... }`.
6. Copia esos valores en `js/config.js` (en GitHub: abre el archivo → ✏️ editar → pega → *Commit changes*).

> Los valores de `firebaseConfig` no son secretos: Firebase está diseñado para que vayan en la página. La protección la dan las reglas del paso 3.

## Paso 3 – Publicar la app (link para el equipo)

**Opción A: GitHub Pages** (requiere que el repositorio sea **público** en el plan gratuito de GitHub)
1. Junta esta rama con `main` (con un Pull Request, o pídele a Claude que lo haga).
2. En GitHub: **Settings → Pages** → *Source*: “Deploy from a branch” → rama `main`, carpeta `/ (root)` → **Save**.
3. En 1 o 2 minutos tendrás un link como `https://TU-USUARIO.github.io/app-checklist/`.

**Opción B: repositorio privado.** Usa Firebase Hosting o Netlify (arrastrando la carpeta a <https://app.netlify.com/drop>).

Luego, en la app: **Administración → Equipo → Copiar / compartir** y envía el link por WhatsApp. Cada persona puede usar “Agregar a pantalla de inicio” para tenerla como app.

---

## Notas y límites

- **Notificaciones:** los avisos llegan con sonido y notificación mientras tengas la app abierta (en el celular o el computador, aunque esté en segundo plano). Para que lleguen con la app completamente cerrada se necesita un servidor de notificaciones push. Se puede agregar más adelante, por ejemplo con avisos por WhatsApp o Telegram.
- **Seguridad:** los PIN son una barrera simple para que nadie marque por otra persona, no una seguridad bancaria. No compartas el link fuera del equipo.
- **Cambios en tareas:** se aplican a los turnos que asignes desde ese momento. Para actualizar los turnos ya asignados, usa *Tareas → Aplicar cambios a turnos de hoy en adelante*. Lo que ya está marcado se conserva.
- **Tareas “Durante el turno”:** no aparecen como pendientes para el turno siguiente, porque son tareas continuas.
- Si una tarea no se marca, en los reportes cuenta como **no hecha** una vez que termina el turno o el día.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Página principal |
| `js/app.js` | Pantallas y lógica |
| `js/store.js` | Guardado de datos (Firebase o modo demo) |
| `js/seed.js` | Tareas iniciales (del documento de tareas) y turnos por defecto |
| `js/config.js` | **Aquí va tu configuración de Firebase** |
| `css/styles.css` | Estilos |
| `firestore.rules` | Reglas de seguridad para Firestore |
