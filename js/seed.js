// Datos iniciales tomados del documento "Tareas Heladería".
// Todo se puede editar después desde Administración → Tareas / Turnos.

export const SECTIONS = [
  { id: 'apertura', name: 'Apertura' },
  { id: 'durante', name: 'Durante el turno' },
  { id: 'especial', name: 'Tarea especial del día' },
  { id: 'cierre', name: 'Cierre' },
];

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const NORMAS = [
  'Se restringe el uso de celular en horario de trabajo.',
  'Se restringen uñas largas o esmaltadas, o usar guantes en casos puntuales.',
];

const APERTURA = [
  'Lavar bachas de metal y limpiar la barquillera.',
  'Montar barquillera (peinar los helados durante la mañana).',
  'Prender cafetera.',
  'Lavar cucharas y balde de cucharas.',
  'Lavar recipientes de toppings y cucharas.',
  'Limpiar vidrios de barquillera, pastelera, máquinas y ventanales.',
  'Reposición de conos y servilletas.',
  'Revisión de implementos e ingredientes necesarios para el día (crema, leche, baño de chocolate, etc.).',
  'Mantener lámparas limpias.',
  'Lavar platos de las tartaletas.',
  'Lavar plásticos que cubren las tartaletas.',
  'Reposición de bebidas y aguas.',
  'Reposición de pastelera y solicitar stock de ser necesario.',
  'Barrer y recoger hojas del antejardín y calle.',
  'Reposición de helados de la barquillera y potes de medio si lo amerita, además del listado para UberEats.',
  'Limpiar la chocolatera.',
  'Sólo en la mañana: tener la vainilla en barquillera (devolverla al terminar el turno).',
  'Limpiar el baño de clientes (espejo, superficies, etc.).',
  'Lavar trapos con los que se limpian las superficies si lo amerita.',
];

const DURANTE = [
  'Mantener la barquillera abastecida y limpia (vidrios delanteros).',
  'Mantener el refrigerador de potes abastecido.',
  'Mantener la reposición de servilletas y conos.',
  'Lavar lozas.',
  'Mantener limpieza de la barquillera (bordes cuando cae helado, helado de otro sabor en una bacha, etc.).',
  'Buena atención al cliente (degustaciones, detalles de sabores, etc.).',
  'Ofrecer productos de cafetería a los clientes.',
  'Atención a mesas si lo amerita.',
  'Recoger y limpiar mesas (y sillas si están chorreadas).',
  'Traspasar helados al refri del punto de venta cuando llegue una segunda persona.',
  'Mantener limpieza del baño de clientes.',
];

const CIERRE = [
  'Sacar la basura de todos los basureros (cocina, baño de clientes y baño del personal).',
  'Trapear pisos de cerámica y madera (barrer bien antes).',
  'Trapear piso de la cocina (pasillo hasta el baño del personal y pasillo de la fábrica).',
  'Desmontar barquillera.',
  'Lavar bachas plásticas.',
  'Guardar conos y canastillas en sus respectivas cajas.',
  'Apagar luces.',
  'Cortar agua.',
  'Apagar aire acondicionado.',
  'Dejar lozas y utensilios lavados y guardados.',
  'Lavar letreros de helados y también el conito base.',
  'Limpiar la pared.',
  'Limpiar cafetera.',
  'Tapar las tartaletas.',
  'Guardar letreros.',
  'Cerrar rejas.',
  'Hacer potes con las bachas que tengan poco helado y sin reposición para el día siguiente (criterio).',
  'Limpiar superficies del mesón de aluminio donde se apoyan las bachas.',
  'Dejar el trapero bien enjuagado y en agua con cloro.',
  'Si cierran más de 2 personas: barrer y trapear la terraza y baño de clientes.',
  'Dejar remojando en cloro los paños de superficies.',
  'Revisar y limpiar pisos/refris de la entrada grande (helado y frutas caídas).',
];

const ESPECIAL = [
  { text: 'Limpieza profunda de la barquillera (retirar sus partes) y de todos los ventanales por dentro y fuera.', days: [1] },
  { text: 'Limpieza de lámparas y de todos los mesones encima y abajo (ordenarlos).', days: [2] },
  { text: 'Limpieza profunda de la baldosa de la entrada (echar cloro en la mañana).', days: [3] },
  { text: 'Descongelar refrigerador y limpiarlo.', days: [4] },
  { text: 'Limpieza del baño de personal.', days: [5] },
];

export function defaultTasks() {
  const tasks = [];
  const push = (prefix, section, list) =>
    list.forEach((t, i) => {
      const item = typeof t === 'string' ? { text: t, days: ALL_DAYS } : t;
      tasks.push({
        id: `${prefix}${String(i + 1).padStart(2, '0')}`,
        text: item.text,
        section,
        days: item.days,
        order: i + 1,
        active: true,
      });
    });
  push('ap', 'apertura', APERTURA);
  push('du', 'durante', DURANTE);
  push('es', 'especial', ESPECIAL);
  push('ci', 'cierre', CIERRE);
  return tasks;
}

export function defaultShiftTypes() {
  return [
    { id: 'manana', name: 'Mañana', start: '10:00', end: '15:00', sections: ['apertura', 'durante', 'especial'] },
    { id: 'tarde', name: 'Tarde', start: '15:00', end: '21:00', sections: ['durante', 'cierre'] },
    { id: 'completo', name: 'Día completo', start: '10:00', end: '21:00', sections: ['apertura', 'durante', 'especial', 'cierre'] },
  ];
}
