export const handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("elixir-stock");
    const data = await store.get("catalog-stock", { type: "json" });
    if (!data) return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null }) };
    return { statusCode: 200, headers: cors, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ stocks: {}, updatedAt: null, error: err.message }) };
  }
};
