We'll built a simple football-themed chat interface that lets users ask questions related to the NFL.

HTML:
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Football Assistant</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div class="chat-container">
      <div class="chat-header">
        <h4>Let's talk Football</h4>
        <span class="header-span">You ask, Qlik answers.</span>
      </div>

      <div class="chat-body" id="chat-body">
        <div class="message assistant">
          <div class="bubble">
            <p>Hey there, champ! Ask me anything.</p>
          </div>
        </div>
      </div>
      <div class="chat-footer">
        <input
          type="text"
          id="chat-input"
          placeholder="Type your Football related question..."
        />
        <button id="send-btn">Send</button>
      </div>
    </div>
    <script src="scripts.js"></script>
  </body>
</html>


Frontend JS:
document.addEventListener("DOMContentLoaded", () => {
const chatBody = document.getElementById("chat-body");
const chatInput = document.getElementById("chat-input");
const sendButton = document.getElementById("send-btn");

// Append a user message immediately
function appendUserMessage(message) {
const messageDiv = document.createElement("div");
messageDiv.classList.add("message", "user");
const bubbleDiv = document.createElement("div");
bubbleDiv.classList.add("bubble");
bubbleDiv.innerHTML = `<p>${message}</p>`;
messageDiv.appendChild(bubbleDiv);
chatBody.appendChild(messageDiv);
chatBody.scrollTop = chatBody.scrollHeight;
}

// Create an assistant bubble that we update with streaming text
function createAssistantBubble() {
const messageDiv = document.createElement("div");
messageDiv.classList.add("message", "assistant");
const bubbleDiv = document.createElement("div");
bubbleDiv.classList.add("bubble");
bubbleDiv.innerHTML = "<p></p>";
messageDiv.appendChild(bubbleDiv);
chatBody.appendChild(messageDiv);
chatBody.scrollTop = chatBody.scrollHeight;
return bubbleDiv.querySelector("p");
}

// Send the question to the backend and stream the answer
function sendQuestion() {
const question = chatInput.value.trim();
if (!question) return;

    // Append the user's message
    appendUserMessage(question);
    chatInput.value = "";

    // Create an assistant bubble for the answer
    const assistantTextElement = createAssistantBubble();

    // Open a connection to stream the answer
    const eventSource = new EventSource(
      `/stream-answers?question=${encodeURIComponent(question)}`
    );

    eventSource.onmessage = function (event) {
      if (event.data === "[DONE]") {
        eventSource.close();
      } else {
        assistantTextElement.innerHTML += event.data;
        chatBody.scrollTop = chatBody.scrollHeight;
      }
    };

    eventSource.onerror = function (event) {
      console.error("EventSource error:", event);
      eventSource.close();
      assistantTextElement.innerHTML += " [Error receiving stream]";
    };
}

sendButton.addEventListener("click", sendQuestion);
chatInput.addEventListener("keydown", (event) => {
if (event.key === "Enter") {
event.preventDefault();
sendQuestion();
}
});
});


Backend node.js script:
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define port and initialize Express app
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static("public"));
app.use(express.json());

// Serve the frontend
app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Endpoint to stream Qlik Answers output
app.get("/stream-answers", async (req, res) => {
const question = req.query.question;
if (!question) {
res.status(400).send("No question provided");
return;
}

// Set headers for streaming response
res.writeHead(200, {
"Content-Type": "text/event-stream",
"Cache-Control": "no-cache",
Connection: "keep-alive",
});

const assistantId = "b82ae7a9-9911-4830-a4f3-f433e88496d2";
const baseUrl = "https://sense-demo.us.qlikcloud.com/api/v1/assistants/";
const bearerToken = process.env["apiKey"];

try {
// Create a new conversation thread
const createThreadUrl = `${baseUrl}${assistantId}/threads`;
const threadResponse = await fetch(createThreadUrl, {
method: "POST",
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${bearerToken}`,
},
body: JSON.stringify({
name: `Conversation for question: ${question}`,
}),
});

    if (!threadResponse.ok) {
      const errorData = await threadResponse.text();
      res.write(`data: ${JSON.stringify({ error: errorData })}\n\n`);
      res.end();
      return;
    }

    const threadData = await threadResponse.json();
    const threadId = threadData.id;

    // Invoke the Qlik Answers streaming endpoint
    const streamUrl = `${baseUrl}${assistantId}/threads/${threadId}/actions/stream`;
    const invokeResponse = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        input: {
          prompt: question,
          promptType: "thread",
          includeText: true,
        },
      }),
    });

    if (!invokeResponse.ok) {
      const errorData = await invokeResponse.text();
      res.write(`data: ${JSON.stringify({ error: errorData })}\n\n`);
      res.end();
      return;
    }

    // Process and stream the response text
    const decoder = new TextDecoder();
    for await (const chunk of invokeResponse.body) {
      let textChunk = decoder.decode(chunk);
      let parts = textChunk.split(/(?<=\})(?=\{)/);
      for (const part of parts) {
        let trimmedPart = part.trim();
        if (!trimmedPart) continue;
        try {
          const parsed = JSON.parse(trimmedPart);
          if (parsed.output && parsed.output.trim() !== "") {
            res.write(`data: ${parsed.output}\n\n`);
          }
        } catch (e) {
          if (trimmedPart && !trimmedPart.startsWith('{"sources"')) {
            res.write(`data: ${trimmedPart}\n\n`);
          }
        }
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
} catch (error) {
res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
res.end();
}
});

// Start the backend server
app.listen(PORT, () => {
console.log(`Backend running on port ${PORT}`);
});


Breaking It Down
Okay, that was a lot of code! Let’s break it down into bite-sized pieces so you can see exactly how our custom Qlik Answers chat interface works.

1. The HTML

Our index.html creates a custom chat UI. It sets up:

A chat body where messages appear (initially with a friendly greeting from the assistant).
A chat footer with an input field and a send button for users to type their questions.

2. The Frontend JavaScript (scripts.js)

This script handles the user interaction:

Appending messages: When you type a question and hit send (or press Enter), your message is added to the chat window.

Creating chat bubbles: It creates separate message bubbles for you (the user) and the assistant.

Streaming the answer: It opens a connection to our backend so that as soon as the assistant’s response is ready, it streams into the assistant’s bubble. This gives you a live, real-time feel without any manual “typing” effect.

3. The Node.js Backend (index.js)

Our backend does the heavy lifting:

Creating a conversation thread: It uses the Assistants API to start a new thread for each question.

Invoking the streaming endpoint: It then sends your question to Qlik Answers and streams the response back.

Processing the stream: As chunks of text come in, the backend cleans them up—splitting any concatenated JSON and only sending the useful text to the frontend.

Closing the stream: Once the complete answer is sent, it signals the end so your chat bubble doesn’t wait indefinitely.

4. How It All Connects

When you send a question:

Your message is displayed immediately in your custom chat bubble.

The backend creates a thread and requests an answer from Qlik Answers.

The response is streamed back to your UI in real time, making it look like the assistant is typing out the answer as it arrives.


P.S: this is just a simple example to introduce you to the new Answers APIs and show you how to get started using them, you'll need to double check limitations and adhere to best practices when using the APIs in a production environment. 