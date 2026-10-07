// Service worker mínimo: permite instalar la app y mostrar notificaciones en el celular.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const c = list[0];
      if (c) return c.focus();
      return self.clients.openWindow('./#/admin/vivo');
    })
  );
});
