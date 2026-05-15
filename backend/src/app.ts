import express = require("express");
import cors = require("cors");
import { FRONTEND_URL } from "./config";
import { authRouter } from "./routes/auth-routes";
import { chatRouter } from "./routes/chat-routes";
import { conversationRouter } from "./routes/conversation-routes";

export const app = express();

app.use(
  cors({
    origin: FRONTEND_URL,
  }),
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello from singh server !!");
});

app.use("/auth", authRouter);
app.use(conversationRouter);
app.use(chatRouter);
