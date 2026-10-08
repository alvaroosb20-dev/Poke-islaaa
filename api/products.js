const { getAll } = require("./_db");
const { imgUrl } = require("./_img");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const list = (await getAll()).map((p) => ({ ...p, img: imgUrl("p" + p.id, p.iv) }));
    res.status(200).json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
