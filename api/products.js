const { getAll } = require("./_db");
const { imgUrl } = require("./_img");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const list = (await getAll()).map((p) => ({ ...p, img: p.iv ? imgUrl("p" + p.id, p.iv) : (typeof p.img === "string" && p.img.startsWith("data:image/") ? p.img : null), xs: Array.isArray(p.xv) ? p.xv.map((v, k) => (v ? imgUrl("p" + p.id + "x" + (k + 1), v) : null)) : undefined, xv: undefined, vid: p.vv ? "/api/img?k=vid_" + p.id + "_prod&v=" + p.vv : undefined, vv: undefined }));
    res.status(200).json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
