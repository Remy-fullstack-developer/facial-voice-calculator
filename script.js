/* ==========================================================
   Voice-Controlled Calculator
   Two ways to calculate:
     A) Keypad -> a small "state" object (digits, operator, equals)
     B) Voice  -> Web Speech API -> text -> numbers/operators -> answer
   No eval() anywhere: spoken sentences go through our own tiny parser.
   ========================================================== */


/* ==========================================================
   1. Page elements
   ========================================================== */
const valueEl      = document.getElementById("value");
const historyEl    = document.getElementById("history");
const resultEl     = document.getElementById("result");
const statusEl     = document.getElementById("status");
const statusTextEl = document.getElementById("statusText");
const transcriptEl = document.getElementById("transcript");
const micBtn       = document.getElementById("micBtn");
const speakToggle  = document.getElementById("speakToggle");
const fileHint     = document.getElementById("fileHint");
const operatorButtons = document.querySelectorAll("[data-operator]");


/* ==========================================================
   2. Constants
   ========================================================== */
const MAX_DIGITS = 12;

// How each operator is shown on screen
const SYMBOLS = { "+": "+", "-": "−", "*": "×", "/": "÷", "%": "%" };

// How each operator is read aloud
const SPOKEN = { "+": "plus", "-": "minus", "*": "times", "/": "divided by", "%": "percent" };


/* ==========================================================
   3. Calculator state (used by the keypad AND by voice)
   ========================================================== */
const state = {
  current: "0",               // number being typed (kept as text)
  previous: null,             // first number, saved when an operator is pressed
  operator: null,             // "+", "-", "*" or "/"
  justCalculated: false,      // true right after "=": next digit starts fresh
  awaitingSecondNumber: false,// true right after pressing an operator
  secondEntered: false,       // true once the 2nd number has been typed
  historyText: ""             // small line above the number, e.g. "5 + 3 ="
};


/* ==========================================================
   4. Screen helpers
   ========================================================== */

// 1234567.5 -> "1,234,567.5"
function formatNumber(text) {
  if (text === "Error" || /e/i.test(text)) return text;
  const [whole, decimal] = text.split(".");
  const wholeFormatted = whole === "-0" ? "-0" : Number(whole).toLocaleString("en-US");
  return decimal !== undefined ? `${wholeFormatted}.${decimal}` : wholeFormatted;
}

// Fixes floating point noise: 0.1 + 0.2 = 0.30000000000000004 -> "0.3"
function roundResult(number) {
  return String(parseFloat(number.toPrecision(12)));
}

function updateDisplay() {
  valueEl.textContent = formatNumber(state.current);

  historyEl.textContent = state.operator
    ? `${formatNumber(state.previous)} ${SYMBOLS[state.operator]}`
    : state.historyText;

  // Highlight the operator button that is waiting for a second number
  operatorButtons.forEach((btn) => {
    const isActive = btn.dataset.operator === state.operator && state.previous !== null;
    btn.classList.toggle("is-active", isActive);
  });
}

// Result area, e.g. "12 × 4 = 48"
function setResult(text) {
  resultEl.textContent = text;
}

// Listening status: type is idle | listening | processing | success | error | unsupported
function setStatus(type, message) {
  statusEl.dataset.state = type;
  statusTextEl.textContent = message;
}

// Read a sentence aloud (only if the "Speak result" switch is on)
function speak(sentence) {
  if (!speakToggle.checked || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(sentence);
  utterance.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}


/* ==========================================================
   5. Keypad logic
   ========================================================== */

// Basic math for two numbers typed on the keypad
function calculate(a, b, operator) {
  const x = parseFloat(a);
  const y = parseFloat(b);
  let result;

  switch (operator) {
    case "+": result = x + y; break;
    case "-": result = x - y; break;
    case "*": result = x * y; break;
    case "/":
      if (y === 0) return "Error";
      result = x / y;
      break;
    default: return b;
  }
  return roundResult(result);
}

// Called before typing: starts a new number when needed
function startFreshIfNeeded() {
  if (state.current === "Error" || state.justCalculated) {
    state.current = "0";
    state.justCalculated = false;
    state.historyText = "";
  }
  if (state.awaitingSecondNumber) {
    state.current = "0";
    state.awaitingSecondNumber = false;
  }
}

function inputDigit(digit) {
  startFreshIfNeeded();
  if (state.operator) state.secondEntered = true;
  if (state.current.replace(/[-.]/g, "").length >= MAX_DIGITS) return;

  state.current = state.current === "0" ? digit : state.current + digit;
}

function inputDecimal() {
  startFreshIfNeeded();
  if (state.operator) state.secondEntered = true;
  if (!state.current.includes(".")) state.current += ".";
}

function showDivideByZero() {
  state.previous = null;
  state.operator = null;
  state.secondEntered = false;
  state.awaitingSecondNumber = false;
  state.justCalculated = true;
  setResult("You can't divide by zero.");
}

function chooseOperator(operator) {
  if (state.current === "Error") return;

  // Chaining: pressing + after "2 + 3" calculates 5 first
  if (state.operator && state.secondEntered) {
    state.current = calculate(state.previous, state.current, state.operator);
    if (state.current === "Error") return showDivideByZero();
  }

  state.previous = state.current;
  state.operator = operator;
  state.secondEntered = false;
  state.awaitingSecondNumber = true;
  state.justCalculated = false;
}

function equals() {
  if (!state.operator || state.current === "Error") return;

  // "5 + =" repeats the first number: 5 + 5
  const second = state.awaitingSecondNumber ? state.previous : state.current;
  const result = calculate(state.previous, second, state.operator);
  const expression = `${formatNumber(state.previous)} ${SYMBOLS[state.operator]} ${formatNumber(second)}`;

  state.historyText = `${expression} =`;
  state.current = result;
  state.previous = null;
  state.operator = null;
  state.secondEntered = false;
  state.awaitingSecondNumber = false;
  state.justCalculated = true;

  setResult(result === "Error" ? "You can't divide by zero." : `${expression} = ${formatNumber(result)}`);
}

function clearAll() {
  state.current = "0";
  state.previous = null;
  state.operator = null;
  state.justCalculated = false;
  state.awaitingSecondNumber = false;
  state.secondEntered = false;
  state.historyText = "";
  setResult("—");
}

function deleteLast() {
  if (state.current === "Error" || state.justCalculated) return clearAll();
  state.current = state.current.length > 1 ? state.current.slice(0, -1) : "0";
  if (state.current === "-") state.current = "0";
}

function percent() {
  if (state.current === "Error") return;
  state.current = roundResult(parseFloat(state.current) / 100);
}


/* ==========================================================
   6. Voice logic
   Pipeline:  "twelve times four"
              -> tokens ["12", "*", "4"]
              -> evaluate -> 48
   ========================================================== */

/* ---- 6a. Number words ("twenty five" -> 25) ---- */
const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS   = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1000, million: 1000000 };

// Words the microphone often mixes up
const HOMOPHONES = { for: "four", won: "one", too: "two", ate: "eight" };

const isUnit  = (w) => w !== undefined && Object.hasOwn(UNITS, w);
const isTens  = (w) => w !== undefined && Object.hasOwn(TENS, w);
const isScale = (w) => w !== undefined && Object.hasOwn(SCALES, w);
const isNumberWord = (w) => isUnit(w) || isTens(w) || isScale(w);

// One spoken digit ("five" or "5") -> "5", otherwise null
function digitValue(word) {
  if (/^\d$/.test(word)) return word;
  if (isUnit(word) && UNITS[word] < 10) return String(UNITS[word]);
  return null;
}

// Reads digits after "point": "one four" -> "14"
function readDecimalDigits(tokens, start) {
  let digits = "";
  let i = start;
  while (i < tokens.length) {
    const digit = digitValue(tokens[i]);
    if (digit === null) break;
    digits += digit;
    i++;
  }
  return { digits, next: i };
}

// Turns number words into digits, leaves everything else untouched
function convertNumberWords(tokens) {
  const out = [];
  let i = 0;

  while (i < tokens.length) {
    const word = tokens[i];

    if (isNumberWord(word)) {
      // Build one number: "two hundred and fifty" -> 250
      let total = 0;
      let current = 0;

      while (i < tokens.length) {
        const w = tokens[i];
        if (w === "and" && isScale(tokens[i - 1]) && isNumberWord(tokens[i + 1])) { i++; continue; }
        if (!isNumberWord(w)) break;

        if (isUnit(w)) current += UNITS[w];
        else if (isTens(w)) current += TENS[w];
        else if (w === "hundred") current = (current || 1) * 100;
        else { total += (current || 1) * SCALES[w]; current = 0; }
        i++;
      }

      let number = String(total + current);

      // "three point one four" -> 3.14
      if (tokens[i] === "point") {
        const { digits, next } = readDecimalDigits(tokens, i + 1);
        if (digits) { number += "." + digits; i = next; }
      }
      out.push(number);

    } else if (word === "point" || (/^\d+$/.test(word) && tokens[i + 1] === "point")) {
      // "3 point 5" or "point five"
      const hasWhole = word !== "point";
      const { digits, next } = readDecimalDigits(tokens, i + (hasWhole ? 2 : 1));
      if (digits) { out.push((hasWhole ? word : "0") + "." + digits); i = next; }
      else { out.push(word); i++; }

    } else if (word === "and") {
      out.push("+");   // "five and three" -> 5 + 3
      i++;

    } else {
      out.push(word);
      i++;
    }
  }
  return out;
}

/* ---- 6b. Spoken sentence -> clean tokens ---- */
const FILLER_WORDS = /\b(what is|what's|whats|how much is|calculate|compute|please|the result of|result of|tell me|equals|equal to|equal|is)\b/g;

const OPERATOR_PHRASES = [
  [/\b(multiplied by|multiply by|multiplied|times)\b/g, " * "],
  [/\b(divided by|divide by|divided|over)\b/g, " / "],
  [/\b(added to|add|plus)\b/g, " + "],
  [/\b(minus|subtract|negative)\b/g, " - "],
  [/\bpercent of\b/g, " % * "],      // "50 percent of 200" -> 50% × 200
  [/\b(percent|per cent)\b/g, " % "]
];

const TOKEN_PATTERN = /^(\d+(\.\d+)?|\.\d+|[+\-*/%])$/;
const EXAMPLE = "Try saying “five plus three”.";

function speechToTokens(rawText) {
  let text = rawText.toLowerCase();

  // Symbols the browser may type for us
  text = text.replace(/×/g, " * ").replace(/÷/g, " / ").replace(/[−–]/g, " - ");
  text = text.replace(/(\d)\s*x\s*(\d)/g, "$1 * $2").replace(/\bx\b/g, " * ");
  text = text.replace(/(\d),(?=\d{3})/g, "$1");     // 1,000 -> 1000
  text = text.replace(/([a-z])-(?=[a-z])/g, "$1 "); // twenty-five -> twenty five

  text = text.replace(FILLER_WORDS, " ");
  OPERATOR_PHRASES.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  // Remove leftover punctuation and put spaces around operators
  text = text.replace(/[?!,:;"'“”$=]/g, " ").replace(/\.(?!\d)/g, " ");
  text = text.replace(/([+\-*/%])/g, " $1 ");

  let tokens = text.split(/\s+/).filter(Boolean);
  tokens = tokens.map((w) => (Object.hasOwn(HOMOPHONES, w) ? HOMOPHONES[w] : w));
  tokens = convertNumberWords(tokens);

  if (tokens.length === 0) {
    throw new Error(`I didn't catch a calculation. ${EXAMPLE}`);
  }
  const unknown = tokens.find((t) => !TOKEN_PATTERN.test(t));
  if (unknown) {
    throw new Error(`I couldn't understand “${unknown}”. ${EXAMPLE}`);
  }
  return tokens;
}

/* ---- 6c. Tiny math parser (follows normal rules: × ÷ before + −) ---- */
function evaluate(tokens) {
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];

  // expression = term (("+" | "-") term)*
  function parseExpression() {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  // term = unary (("*" | "/") unary)*
  function parseTerm() {
    let value = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const right = parseUnary();
      if (op === "/" && right === 0) throw new Error("You can't divide by zero.");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  // unary = ("-" | "+") unary | number "%"*
  function parseUnary() {
    if (peek() === "-") { next(); return -parseUnary(); }
    if (peek() === "+") { next(); return parseUnary(); }

    const token = next();
    if (token === undefined || !/^[\d.]/.test(token)) {
      throw new Error(`That calculation looks incomplete. ${EXAMPLE}`);
    }
    let value = parseFloat(token);
    while (peek() === "%") { next(); value /= 100; }
    return value;
  }

  const result = parseExpression();
  if (position < tokens.length) {
    throw new Error(`I couldn't understand that calculation. ${EXAMPLE}`);
  }
  if (!Number.isFinite(result)) {
    throw new Error("That number is too large for me.");
  }
  return result;
}

/* ---- 6d. Voice commands: "clear", "delete", "equals" ---- */
const VOICE_COMMANDS = [
  {
    words: ["clear", "reset", "clear all", "all clear", "start over"],
    run() { clearAll(); return "Cleared."; }
  },
  {
    words: ["delete", "backspace", "undo", "remove last"],
    run() { deleteLast(); return "Deleted the last digit."; }
  },
  {
    words: ["equals", "equal", "calculate", "result", "enter"],
    run() {
      if (!state.operator) return "Nothing to calculate yet.";
      equals();
      return "Calculated!";
    }
  }
];

function runVoiceCommand(sentence) {
  const command = VOICE_COMMANDS.find((c) => c.words.includes(sentence));
  if (!command) return false;

  const message = command.run();
  updateDisplay();
  setStatus("success", message);
  return true;
}

/* ---- 6e. Handle one finished spoken sentence ---- */
function handleSpeech(rawText) {
  setStatus("processing", "Working it out…");
  transcriptEl.textContent = `“${rawText}”`;

  // 1) Is it a command such as "clear"?
  const sentence = rawText.toLowerCase().replace(/[.!?,]/g, "").trim();
  if (runVoiceCommand(sentence)) return;

  // 2) Otherwise treat it as a calculation
  try {
    const tokens = speechToTokens(rawText);
    const resultText = roundResult(evaluate(tokens));

    const expression = tokens.map((t) => SYMBOLS[t] ?? formatNumber(t)).join(" ");
    const spokenExpression = tokens.map((t) => SPOKEN[t] ?? t).join(" ");

    // Put the answer on the calculator so the keypad can continue from it
    state.current = resultText;
    state.previous = null;
    state.operator = null;
    state.justCalculated = true;
    state.awaitingSecondNumber = false;
    state.secondEntered = false;
    state.historyText = `${expression} =`;

    updateDisplay();
    setResult(`${expression} = ${formatNumber(resultText)}`);
    setStatus("success", "Done! Tap the mic to speak again.");
    speak(`${spokenExpression} equals ${resultText.replace("-", "minus ")}`);

  } catch (error) {
    setStatus("error", error.message);
  }
}

/* ---- 6f. Microphone + Web Speech API ---- */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const ERROR_MESSAGES = {
  "no-speech": "I didn't hear anything. Tap the mic and try again.",
  "audio-capture": "No microphone found. Plug one in or use the keypad.",
  "not-allowed": "Microphone is blocked. Allow it in the address bar, or use the keypad.",
  "service-not-allowed": "Microphone is blocked. Allow it in the address bar, or use the keypad.",
  "network": "Voice needs an internet connection. Use the keypad for now.",
  "language-not-supported": "This language isn't supported. Use the keypad."
};

let recognition = null;
let isListening = false;
let finalTranscript = "";
let errorShown = false;

function setupVoice() {
  // Voice not available (e.g. Firefox): keypad still works
  if (!SpeechRecognition) {
    micBtn.disabled = true;
    setStatus("unsupported", "Voice isn't supported here. Use Chrome, or the keypad below.");
    transcriptEl.textContent = "";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;   // show words while the person is still speaking
  recognition.continuous = false;      // stop automatically after one sentence

  recognition.onstart = () => {
    isListening = true;
    finalTranscript = "";
    errorShown = false;
    micBtn.classList.add("is-listening");
    micBtn.setAttribute("aria-label", "Stop listening");
    transcriptEl.textContent = "…";
    setStatus("listening", "Listening… speak now");
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += text;
      else interim += text;
    }
    transcriptEl.textContent = `“${(finalTranscript + interim).trim()}”`;
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") return;   // we stopped it ourselves
    errorShown = true;
    setStatus("error", ERROR_MESSAGES[event.error] || "Voice recognition failed. Try again or use the keypad.");
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("is-listening");
    micBtn.setAttribute("aria-label", "Start listening");

    if (errorShown) return;                  // an error message is already showing
    if (finalTranscript.trim()) {
      handleSpeech(finalTranscript.trim());
    } else {
      setStatus("error", "I didn't hear anything. Tap the mic and try again.");
    }
  };
}

function toggleMic() {
  if (!recognition) return;

  if (isListening) {
    recognition.stop();   // stop and process what was heard
    return;
  }
  window.speechSynthesis?.cancel();   // don't let the mic hear our own voice
  try {
    recognition.start();
  } catch (error) {
    // start() throws if it is already starting; safe to ignore
  }
}


/* ==========================================================
   7. Events
   ========================================================== */

// Keypad clicks
document.querySelector(".keys").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const { digit, operator, action } = button.dataset;

  if (digit !== undefined) inputDigit(digit);
  else if (operator) chooseOperator(operator);
  else if (action === "decimal") inputDecimal();
  else if (action === "equals") equals();
  else if (action === "clear") clearAll();
  else if (action === "delete") deleteLast();
  else if (action === "percent") percent();

  updateDisplay();
});

// Microphone button
micBtn.addEventListener("click", toggleMic);

// Keyboard support (M = microphone)
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key;

  if (/^[0-9]$/.test(key)) inputDigit(key);
  else if (["+", "-", "*", "/"].includes(key)) chooseOperator(key);
  else if (key === "x" || key === "X") chooseOperator("*");
  else if (key === "." || key === ",") inputDecimal();
  else if (key === "Enter" || key === "=") { event.preventDefault(); equals(); }
  else if (key === "Backspace") deleteLast();
  else if (key === "Escape" || key.toLowerCase() === "c") clearAll();
  else if (key === "%") percent();
  else if (key.toLowerCase() === "m") { toggleMic(); return; }
  else return;

  updateDisplay();
});


/* ==========================================================
   8. Start
   ========================================================== */
// Lets other scripts (camera hand-writing, in gesture.js) type into the calculator
window.calculator = {
  writeDigit(digit) {
    inputDigit(digit);
    updateDisplay();
  }
};

setupVoice();
updateDisplay();

// gesture.js is a module, and modules can't load from a double-clicked file
if (location.protocol === "file:") {
  document.getElementById("camBtn").disabled = true;
  document.getElementById("camStatus").textContent =
    "Camera needs http://localhost. Open this folder with VS Code Live Server.";
}

// Opening the file directly (file://) makes Chrome ask for the mic every time
if (location.protocol === "file:") fileHint.hidden = false;
