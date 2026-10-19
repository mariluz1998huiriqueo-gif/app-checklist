# 🍦 Checklist Heladería

App web para el celular: cada trabajador ve y marca las tareas de **su turno**, y administración ve el avance **en tiempo real**, recibe **avisos** y obtiene **reportes**.

## Qué hace

**Para el equipo (desde el celular)**
- Elige su nombre y entra con su PIN (de 2 a 6 dígitos). El celular lo recuerda: no hay que volver a ingresarlo.
- Ve solo las tareas de su turno de hoy (Apertura / Tareas especiales del día / Cierre) y las marca al hacerlas.
- **Durante el día** y **Normas** aparecen como listas desplegables de recordatorio (no se marcan, porque no se usa el celular en el turno).
- **Tareas con hora y alarma** (ej. sacar la basura martes, jueves y sábado a las 18:00 porque pasa el camión): suena 15 minutos antes y a la hora.
- **Tareas compartidas (👥):** si coinciden varias personas, cuando una marca la tarea queda lista para todas.
- **Compañeras sin celular** (ej. Monse): los días que tiene turno, quien trabaje con ella ve una segunda columna de casillas para marcar lo que hizo ella.
- **Dejar para otro día (⋯):** si una tarea no se alcanzó o se hizo a medias (ej. descongelar 1 de 3 refris), se deja pendiente con una nota para el día siguiente.
- **Revisar turno anterior:** quien llega puede marcar lo que quedó sin hacer (**Lo hice**) o **Reportar** algo que quedó mal (ej. el agua quedó corriendo). Administración recibe un aviso.
- Presiona “Terminar turno”. Si quedan tareas sin marcar, administración recibe un aviso.

**Para administración**
- **En vivo:** avance de cada turno de hoy, estado (sin iniciar / en curso / terminado / fuera de horario), hora de cada tarea y avisos.
- **Turnos:** planilla semanal para asignar el turno de cada persona cada día, con la opción de copiar la semana anterior.
- **Reportes:** hoy, ayer, esta semana, semana pasada, este mes o las fechas que elijas. Incluye el % de cumplimiento por persona y por día, las tareas no hechas, reportadas y postergadas, **cuántas tareas hizo cada persona** (para ver quién trabajó más en un turno compartido), las tareas que más se olvidan y quién cubrió a quién. Se puede descargar en Excel (CSV).
- **Tareas:** agregar, editar o desactivar tareas, y elegir qué días aplican.
- **Equipo:** agregar personas con su PIN y compartir el link de la app.
- **Ajustes:** activar notificaciones, cambiar el PIN de administración y descargar un respaldo.

Administración entra con su cuenta de Google (en modo demo, con el PIN 1234).

**🛒 App de Compras** (link aparte: `…/app-checklist/compras/`)
- **Administración** (misma cuenta de Google) arma la lista eligiendo productos de un catálogo por categorías (Alimentos, Limpieza, Desechables, Otros). Se pueden crear productos y categorías nuevas en cualquier momento. Cada producto en la lista puede llevar cantidad, una marca de urgente y una nota.
- **Quien compra** entra con su PIN y solo ve la lista de compras. Marca lo comprado; si algo no se pudo comprar, deja un comentario y administración recibe un aviso. También puede enviar mensajes y avisar “Terminé de comprar”.
- **El equipo** no tiene acceso a Compras. Solo tiene en su checklist el botón **“⚠️ Falta algo”**, que le llega a administración; ella decide si lo agrega a la lista.
- **Historial** de lo comprado y lo que no se pudo comprar (últimos 60 días).

---

## Paso 1 – Probar en modo demo (sin configurar nada)

Si `js/config.js` está vacío, la app funciona en **modo demo**: los datos quedan solo en el dispositivo donde se abre. Sirve para conocerla, pero **no comparte datos entre celulares**.

## Paso 2 – Conectar Firebase (gratis) para compartir datos en tiempo real

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google → **Crear proyecto** (puedes desactivar Google Analytics).
2. Menú **Compilación → Firestore Database** → **Crear base de datos** → ubicación `southamerica-east1` (São Paulo) → modo **producción**.
3. Pestaña **Reglas** de Firestore: borra todo, pega el contenido del archivo [`firestore.rules`](firestore.rules) y presiona **Publicar**.
4. Menú **Compilación → Authentication** → **Comenzar** → pestaña **Sign-in method**:
   - activa **Anónimo** (lo usa el equipo, con su PIN);
   - activa **Google** (lo usas tú para Administración) y elige tu correo como correo de asistencia.
5. En la misma sección, pestaña **Configuración → Dominios autorizados** → **Agregar dominio** → `TU-USUARIO.github.io`.
6. Engranaje ⚙️ **Configuración del proyecto** → “Tus apps” → ícono **`</>`** (Web) → registra la app. Copia los valores de `firebaseConfig` en [`js/config.js`](js/config.js).

> Los valores de `firebaseConfig` no son secretos (toda app web de Firebase los muestra). La protección la dan las reglas del paso 3.

## Paso 3 – Publicar la app (link para el equipo) con GitHub Pages

1. En GitHub: **Settings → General → Danger Zone → Change visibility → Public**.
2. **Settings → Pages** → *Source*: “Deploy from a branch” → elige la rama principal del repositorio y la carpeta `/ (root)` → **Save**.
3. En 1–2 minutos tendrás el link: `https://TU-USUARIO.github.io/app-checklist/`.

## Paso 4 – Primer ingreso

1. Abre el link → **Administración → Entrar con Google**. **La primera cuenta que entra queda como única administradora**: hazlo tú apenas publiques.
2. En **Equipo**, agrega a cada persona con su PIN. En **Turnos**, asigna la semana.
3. Comparte el link con el equipo desde **Equipo → Copiar / compartir**.

---

## Seguridad

- **Administración:** solo la cuenta de Google registrada puede ver reportes, PIN, avisos y editar tareas, turnos y personas.
- **Equipo:** el PIN se comprueba en el servidor de Firebase y nunca se envía a los celulares. Con una sesión válida, cada persona solo puede marcar tareas, terminar **su** turno y generar avisos. Si cambias el PIN de alguien o lo desactivas, pierde el acceso al instante.
- **Sin sesión**, alguien con el link solo puede ver los nombres del equipo y la lista de tareas.
- El código es público, pero no contiene datos ni contraseñas: todo vive en tu Firebase.
- Las reglas tienen pruebas automáticas (emulador de Firebase).

## Notas y límites

- **Notificaciones:** los avisos llegan con sonido y notificación mientras tengas la app abierta (en el celular o el computador, aunque esté en segundo plano). Para que lleguen con la app completamente cerrada se necesita un servidor de notificaciones push. Se puede agregar más adelante, por ejemplo con avisos por WhatsApp o Telegram.
- **PIN:** de 2 a 6 dígitos, distinto para cada persona. Uno corto es fácil de recordar pero también de adivinar.
- **Cambios en tareas:** se aplican a los turnos que asignes desde ese momento. Para actualizar los turnos ya asignados, usa *Tareas → Aplicar cambios a turnos de hoy en adelante*. Lo que ya está marcado se conserva.
- **Tareas compartidas (👥):** si varias personas coinciden el mismo día (por ejemplo, dos o más en el cierre), cuando una marca una tarea compartida queda lista para todas, con el nombre de quien la hizo. Por defecto son compartidas Apertura, Tarea especial y Cierre; se cambia por tarea en *Tareas*.
- **Sesión:** el PIN se ingresa una sola vez por celular. La app lo recuerda hasta que la persona presione “Salir” o administración le cambie el PIN.
- **Alarmas:** suenan si la app está abierta en el celular (aunque sea en segundo plano). Si el celular cerró la app, no suenan.
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
