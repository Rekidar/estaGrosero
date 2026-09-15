// api/ratings.js
// Función serverless (Vercel) que usa el repo de GitHub como base de datos.
// Lee y escribe data/ratings.json a través de la API de contenidos de GitHub.

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;
const FILE_PATH = "data/ratings.json";

const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

async function leerArchivo() {
  const r = await fetch(`${GITHUB_API}?ref=${BRANCH}`, {
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    throw new Error(`No se pudo leer ratings.json (${r.status})`);
  }
  const json = await r.json();
  const contenido = Buffer.from(json.content, "base64").toString("utf-8");
  return { data: JSON.parse(contenido), sha: json.sha };
}

async function escribirArchivo(data, sha, mensaje) {
  const nuevoContenido = Buffer.from(
    JSON.stringify(data, null, 2)
  ).toString("base64");

  return fetch(GITHUB_API, {
    method: "PUT",
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: mensaje,
      content: nuevoContenido,
      sha,
      branch: BRANCH,
    }),
  });
}

export default async function handler(req, res) {
  // CORS básico por si sirves el HTML desde otro dominio (ej. GitHub Pages)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!OWNER || !REPO || !TOKEN) {
    return res.status(500).json({
      error: "Faltan variables de entorno: GITHUB_OWNER, GITHUB_REPO o GITHUB_TOKEN",
    });
  }

  if (req.method === "GET") {
    try {
      const { data } = await leerArchivo();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { id, valor, votoAnterior } = req.body || {};

    if (!id || !valor || valor < 1 || valor > 5) {
      return res.status(400).json({ error: "Datos de voto inválidos" });
    }

    // Reintenta si otro voto llegó al mismo tiempo (conflicto de sha)
    for (let intento = 0; intento < 4; intento++) {
      try {
        const { data, sha } = await leerArchivo();

        if (!data[id]) data[id] = { sum: 0, count: 0 };

        if (votoAnterior) {
          data[id].sum = data[id].sum - Number(votoAnterior) + Number(valor);
        } else {
          data[id].sum += Number(valor);
          data[id].count += 1;
        }

        const mensaje = `Voto: ${id} -> ${valor} estrella(s)`;
        const putRes = await escribirArchivo(data, sha, mensaje);

        if (putRes.status === 409) {
          // El archivo cambió entre la lectura y la escritura, reintentar
          continue;
        }
        if (!putRes.ok) {
          const detalle = await putRes.text();
          throw new Error(`No se pudo guardar el voto (${putRes.status}): ${detalle}`);
        }

        return res.status(200).json(data[id]);
      } catch (e) {
        if (intento === 3) {
          return res.status(500).json({ error: e.message });
        }
      }
    }

    return res.status(500).json({ error: "No se pudo guardar el voto tras varios intentos" });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
