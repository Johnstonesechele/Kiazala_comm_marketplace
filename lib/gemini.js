let genai;
try {
  genai = require("@google/genai");
} catch {
  genai = null;
}

function ensureGeminiConfigured() {
  const key = process.env.GEMINI_API_KEY;
  if (!genai) {
    throw new Error("Gemini SDK is not available on server");
  }
  if (!key) {
    throw new Error("GEMINI_API_KEY is missing in .env");
  }
}

async function runGeminiRequest({ model, config, contents }) {
  const client = new genai.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await client.models.generateContent({
    model,
    config,
    contents
  });
  return response?.text || "";
}

async function promptGemini({ systemInstruction, prompt, fallback }) {
  ensureGeminiConfigured();

  const modelsToTry = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];

  for (const model of modelsToTry) {
    try {
      const text = await runGeminiRequest({
        model,
        config: systemInstruction ? { systemInstruction } : undefined,
        contents: prompt
      });
      if (text) return text;
    } catch (err) {
      const msg = err?.message || String(err);
      // Stop retrying on auth/quota errors
      if (msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes("RESOURCE_EXHAUSTED")) {
        console.error(`[Gemini] Unrecoverable error on model ${model}:`, msg);
        break;
      }
      console.warn(`[Gemini] Model ${model} failed:`, msg, "– trying next model");
    }
  }

  throw new Error(fallback || "Gemini request failed");
}

async function promptGeminiMultimodal({ systemInstruction, parts, fallback }) {
  ensureGeminiConfigured();

  const modelsToTry = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];
  const contents = [{ role: "user", parts }];

  for (const model of modelsToTry) {
    try {
      const text = await runGeminiRequest({
        model,
        config: systemInstruction ? { systemInstruction } : undefined,
        contents
      });
      if (text) return text;
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes("RESOURCE_EXHAUSTED")) {
        break;
      }
    }
  }

  throw new Error(fallback || "Gemini multimodal request failed");
}

module.exports = {
  promptGemini,
  promptGeminiMultimodal
};
