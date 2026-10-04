const { getAll } = require("./_db");
module.exports = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(await getAll());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
