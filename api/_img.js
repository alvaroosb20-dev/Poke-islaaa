// Almacén de imágenes: cada foto se guarda aparte y se sirve desde /api/img con caché,
// para que la lista de productos y la ruleta no descarguen todas las fotos en cada visita.
const { cmd } = require("./_db");

const KEY = /^[a-z0-9_]{1,60}$/;
const MAX = 1500000; // ~1,1 MB de imagen

function checkImg(data) {
  if (typeof data !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error("Imagen no válida (usa JPG, PNG o WebP)");
  if (data.length > MAX) throw new Error("Imagen demasiado grande");
}

async function putImg(key, data) {
  if (!KEY.test(key)) throw new Error("Imagen no válida");
  checkImg(data);
  await cmd(["SET", "img:" + key, data]);
  return Date.now();
}

async function delImg(key) {
  if (KEY.test(key)) await cmd(["DEL", "img:" + key]);
}

const imgUrl = (key, v) => (v ? "/api/img?k=" + key + "&v=" + v : null);

module.exports = { KEY, checkImg, putImg, delImg, imgUrl };
