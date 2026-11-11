/**
 * Banco de preguntas sorpresa del final de carrera. Para añadir una, copia
 * cualquier entrada: cuatro opciones y `correcta` es el índice (0–3) de la
 * buena. El orden de las opciones se baraja al mostrarlas.
 */
export interface Pregunta {
  texto: string;
  opciones: readonly [string, string, string, string];
  correcta: 0 | 1 | 2 | 3;
}

export const PREGUNTAS: readonly Pregunta[] = [
  { texto: '¿Cuánto es 1 + 1?', opciones: ['3', '11', '2', '5'], correcta: 2 },
  { texto: '¿Cuánto es 7 × 8?', opciones: ['54', '56', '64', '48'], correcta: 1 },
  { texto: '¿Cuánto es 15 + 27?', opciones: ['42', '32', '43', '52'], correcta: 0 },
  { texto: '¿Cuánto es 100 ÷ 4?', opciones: ['20', '40', '25', '24'], correcta: 2 },
  { texto: '¿Cuánto es 9 × 9?', opciones: ['72', '81', '99', '91'], correcta: 1 },
  { texto: '¿Cuánto es 12 − 5?', opciones: ['6', '8', '7', '17'], correcta: 2 },
  { texto: '¿Cuál es la raíz cuadrada de 49?', opciones: ['6', '7', '8', '9'], correcta: 1 },
  { texto: '¿Cuánto es el 50 % de 80?', opciones: ['30', '45', '40', '50'], correcta: 2 },
  { texto: '¿Cuántos lados tiene un hexágono?', opciones: ['5', '6', '7', '8'], correcta: 1 },
  { texto: '¿Cuántos minutos tiene una hora?', opciones: ['100', '30', '60', '90'], correcta: 2 },
  { texto: '¿Cuántos días tiene una semana?', opciones: ['5', '7', '6', '10'], correcta: 1 },
  { texto: '¿Cuántos meses tiene un año?', opciones: ['10', '11', '12', '13'], correcta: 2 },
  { texto: '¿Cuál es el planeta más grande del sistema solar?', opciones: ['Marte', 'Júpiter', 'Saturno', 'Tierra'], correcta: 1 },
  { texto: '¿Qué planeta es conocido como el planeta rojo?', opciones: ['Venus', 'Mercurio', 'Marte', 'Neptuno'], correcta: 2 },
  { texto: '¿Cuál es el océano más grande del mundo?', opciones: ['Atlántico', 'Índico', 'Ártico', 'Pacífico'], correcta: 3 },
  { texto: '¿Cuál es la capital de Francia?', opciones: ['Roma', 'París', 'Madrid', 'Berlín'], correcta: 1 },
  { texto: '¿Cuál es la capital de Japón?', opciones: ['Pekín', 'Seúl', 'Tokio', 'Bangkok'], correcta: 2 },
  { texto: '¿Cuál es la capital de Argentina?', opciones: ['Buenos Aires', 'Santiago', 'Lima', 'Montevideo'], correcta: 0 },
  { texto: '¿Cuál es la capital de Bolivia (sede de gobierno)?', opciones: ['Sucre', 'La Paz', 'Cochabamba', 'Santa Cruz'], correcta: 1 },
  { texto: '¿En qué continente está Egipto?', opciones: ['Asia', 'Europa', 'África', 'Oceanía'], correcta: 2 },
  { texto: '¿Cuál es el río más caudaloso del mundo?', opciones: ['Nilo', 'Amazonas', 'Misisipi', 'Danubio'], correcta: 1 },
  { texto: '¿Cuál es la montaña más alta del mundo?', opciones: ['Aconcagua', 'K2', 'Everest', 'Kilimanjaro'], correcta: 2 },
  { texto: '¿Qué gas respiran las plantas para hacer la fotosíntesis?', opciones: ['Oxígeno', 'Dióxido de carbono', 'Helio', 'Nitrógeno'], correcta: 1 },
  { texto: '¿Cuál es la fórmula química del agua?', opciones: ['CO2', 'H2O', 'O2', 'NaCl'], correcta: 1 },
  { texto: '¿A qué temperatura hierve el agua al nivel del mar?', opciones: ['50 °C', '90 °C', '100 °C', '120 °C'], correcta: 2 },
  { texto: '¿Cuántos huesos tiene el cuerpo humano adulto?', opciones: ['106', '206', '306', '186'], correcta: 1 },
  { texto: '¿Qué órgano bombea la sangre?', opciones: ['Pulmón', 'Hígado', 'Corazón', 'Riñón'], correcta: 2 },
  { texto: '¿Cuál es el animal terrestre más rápido?', opciones: ['León', 'Guepardo', 'Caballo', 'Gacela'], correcta: 1 },
  { texto: '¿Cuántas patas tiene una araña?', opciones: ['6', '8', '10', '4'], correcta: 1 },
  { texto: '¿Cuál es el mamífero más grande?', opciones: ['Elefante', 'Ballena azul', 'Jirafa', 'Tiburón ballena'], correcta: 1 },
  { texto: '¿Cuántos colores tiene el arcoíris?', opciones: ['5', '6', '7', '8'], correcta: 2 },
  { texto: '¿Quién pintó la Mona Lisa?', opciones: ['Picasso', 'Van Gogh', 'Leonardo da Vinci', 'Miguel Ángel'], correcta: 2 },
  { texto: '¿Quién escribió «Don Quijote de la Mancha»?', opciones: ['Cervantes', 'Lope de Vega', 'García Márquez', 'Neruda'], correcta: 0 },
  { texto: '¿Cuántos jugadores tiene un equipo de fútbol en la cancha?', opciones: ['9', '10', '11', '12'], correcta: 2 },
  { texto: '¿Cuántas ruedas tiene un auto normal?', opciones: ['3', '4', '5', '6'], correcta: 1 },
  { texto: '¿Qué color del semáforo indica que debes detenerte?', opciones: ['Verde', 'Amarillo', 'Rojo', 'Azul'], correcta: 2 },
  { texto: '¿Qué significa la «F» en la Fórmula 1?', opciones: ['Fuerza', 'Fórmula', 'Fuego', 'Final'], correcta: 1 },
  { texto: '¿Qué mide el velocímetro de un auto?', opciones: ['Combustible', 'Velocidad', 'Temperatura', 'Distancia'], correcta: 1 },
  { texto: '¿Qué combustible usan los autos eléctricos?', opciones: ['Gasolina', 'Diésel', 'Electricidad', 'Gas'], correcta: 2 },
  { texto: '¿Cuántos kilómetros son 1000 metros?', opciones: ['1', '10', '100', '0,1'], correcta: 0 },
  { texto: '¿Cuántos segundos tiene un minuto?', opciones: ['100', '60', '30', '120'], correcta: 1 },
  { texto: '¿Qué instrumento tiene 88 teclas?', opciones: ['Guitarra', 'Violín', 'Piano', 'Batería'], correcta: 2 },
];
