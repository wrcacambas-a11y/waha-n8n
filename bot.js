import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import express from "express";
import fs from "fs";
import { google } from "googleapis";
import pino from "pino";

// === CONFIGURAÇÕES ===
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}");

// === TRATAMENTO DE ERROS GLOBAIS ===
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// === FUNÇÃO PARA LER PLANILHA ===
async function carregarPlanilha() {
  try {
    const auth = new google.auth.JWT(
      GOOGLE_CREDENTIALS.client_email,
      null,
      GOOGLE_CREDENTIALS.private_key.replace(/\\n/g, '\n'),
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );

    const sheets = google.sheets({ version: "v4", auth });
    const range = "Plan1!A:D"; // Endereço | Bairro | Valor Limpo | Valor Sujo

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log("📊 Nenhum dado encontrado na planilha.");
      return [];
    }

    const [header, ...data] = rows;
    const bairros = data.map((row) => ({
      endereco: row[0] || "",
      bairro: row[1] || "",
      valorLimpo: row[2] || "",
      valorSujo: row[3] || "",
    }));

    console.log(`📊 Planilha carregada: ${bairros.length} bairros`);
    return bairros;
  } catch (error) {
    console.error("Erro ao carregar planilha:", error);
    return [];
  }
}

// === BOT WHATSAPP ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: "info" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Conexão fechada:", reason);
    } else if (connection === "open") {
      console.log("✅ Conectado ao WhatsApp!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;

    const from = m.key.remoteJid;
    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    // Exemplo de atendimento
    if (text.toLowerCase().includes("orçamento")) {
      const bairros = await carregarPlanilha();
      let resposta = "🚛 *Orçamento de Caçamba*\n\n";
      resposta += "Escolha o tipo de resíduo:\n";
      resposta += "1️⃣ Limpo\n";
      resposta += "2️⃣ Sujo\n";
      resposta += "3️⃣ Entulho misto\n";
      resposta += "4️⃣ Madeira\n";
      resposta += "5️⃣ Outros\n\n";
      resposta += `*Obs:* Valores variam por bairro (${bairros.length} cadastrados).`;

      await sock.sendMessage(from, { text: resposta });
    } else {
      await sock.sendMessage(from, { text: "Olá! Envie 'orçamento' para iniciar o atendimento." });
    }
  });
}

// === INICIAR BOT ===
startBot().catch(err => console.error("Erro ao iniciar bot:", err));

// === SERVIDOR EXPRESS ===
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🚛 Chatbot de Caçamba rodando com sucesso!");
});

app.listen(PORT, () => {
  console.log(`🌍 Servidor web ativo na porta ${PORT}`);
});
