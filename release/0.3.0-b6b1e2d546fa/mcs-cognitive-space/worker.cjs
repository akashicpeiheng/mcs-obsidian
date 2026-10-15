"use strict";

// ../mcs-web/shared/errors.mjs
var McsError = class extends Error {
  constructor(code, message, status = 400, details = void 0, retryable = false, recoverable = void 0) {
    super(message);
    this.name = "McsError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryable = retryable;
    this.recoverable = recoverable ?? isRecoverableCode(code);
  }
};
var CODES = {
  BAD_REQUEST: "BAD_REQUEST",
  UNKNOWN_NODE: "UNKNOWN_NODE",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  UNKNOWN_EVIDENCE: "UNKNOWN_EVIDENCE",
  UNKNOWN_PROFILE: "UNKNOWN_PROFILE",
  UNKNOWN_SESSION: "UNKNOWN_SESSION",
  UNKNOWN_LOCALIZATION: "UNKNOWN_LOCALIZATION",
  CONFLICT: "REVISION_CONFLICT",
  EVENT_ID_CONFLICT: "EVENT_ID_CONFLICT",
  VERSION_CONFLICT: "ONTOLOGY_VERSION_CONFLICT",
  ONTOLOGY_INVALID: "ONTOLOGY_INVALID",
  /*
   * 扩展包完整性 / 合成失败（2026-10 加，P1-2）。
   *
   * 与 `ONTOLOGY_INVALID` 是两件事，不能合用一个码：
   * - `ONTOLOGY_INVALID` = **基础本体**坏了（仓库里的公共数据本身有问题）；
   * - `EXTENSION_INVALID` = 基础数据没问题，是**某个已发布内容包**对不上账
   *   （哈希不符、证书文件丢失、与基础数据冲突、合成后校验不过），或者它本该生效却没有生效。
   *
   * 分开的理由是可操作性：前者要修仓库数据，后者只要把包修好或换一份（回滚）；
   * 混成一个码，维护界面只能说「本体有问题」，说不到点子上。
   */
  EXTENSION_INVALID: "EXTENSION_INVALID",
  EVIDENCE_UNSUPPORTED: "EVIDENCE_UNSUPPORTED",
  EVIDENCE_FAILED: "EVIDENCE_FAILED",
  EVIDENCE_RESOURCE: "EVIDENCE_RESOURCE_EXHAUSTED",
  SEARCH_LIMIT: "SEARCH_LIMIT",
  JOB_CANCELLED: "JOB_CANCELLED",
  TUTOR_UNAVAILABLE: "DEEPTUTOR_UNAVAILABLE",
  /*
   * 回合进行中连接断开：与「连不上」是两件事。
   *
   * 「连不上」= 请求根本没送出去，可以重试；「中途断了」= 模型可能已经在跑，
   * 正确处置是到原会话核对，而不是重发。旧版把两者都报成 DEEPTUTOR_UNAVAILABLE，
   * 等于把「不要重发」的情形说成「检查后端再试一次」。
   */
  TUTOR_INTERRUPTED: "DEEPTUTOR_INTERRUPTED",
  TUTOR_AUTH_REQUIRED: "DEEPTUTOR_AUTH_REQUIRED",
  TUTOR_LIVE_UNVERIFIED: "DEEPTUTOR_LIVE_UNVERIFIED",
  IMPORT_INVALID: "IMPORT_INVALID",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL: "INTERNAL",
  /*
   * 账号与权限（2026-10 公网发布前加）。
   *
   * 分成五个码而不是一个「没权限」，因为它们要求用户做的事完全不同：
   * - `AUTH_REQUIRED`：去登录；
   * - `AUTH_REJECTED`：登录信息或验证链接不对，重新来一次；
   * - `FORBIDDEN`：身份没问题，但这个身份不该做这件事（登录也没用）；
   * - `CSRF_REJECTED`：页面状态过期，刷新重试；
   * - `RATE_LIMITED` / `RESOURCE_EXHAUSTED`：现在不行，等一会儿或等队排完。
   *
   * 「对象不存在」与「不属于你」一律返回 `NOT_FOUND`（404），见 `security-store.mjs`：
   * 用 403 区分「存在但不是你的」会变成档案 ID 的存在性探针。
   */
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_REJECTED: "AUTH_REJECTED",
  AUTH_UNAVAILABLE: "AUTH_UNAVAILABLE",
  FORBIDDEN: "FORBIDDEN",
  CSRF_REJECTED: "CSRF_REJECTED",
  RATE_LIMITED: "RATE_LIMITED",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED"
};
var RECOVERABLE_CODES = /* @__PURE__ */ new Set([
  CODES.BAD_REQUEST,
  CODES.UNKNOWN_NODE,
  CODES.UNKNOWN_ACTION,
  CODES.UNKNOWN_EVIDENCE,
  CODES.UNKNOWN_PROFILE,
  CODES.UNKNOWN_SESSION,
  CODES.UNKNOWN_LOCALIZATION,
  CODES.CONFLICT,
  CODES.EVENT_ID_CONFLICT,
  CODES.VERSION_CONFLICT,
  CODES.EVIDENCE_RESOURCE,
  CODES.EVIDENCE_UNSUPPORTED,
  CODES.EVIDENCE_FAILED,
  CODES.SEARCH_LIMIT,
  CODES.JOB_CANCELLED,
  CODES.TUTOR_UNAVAILABLE,
  CODES.TUTOR_INTERRUPTED,
  CODES.TUTOR_AUTH_REQUIRED,
  CODES.TUTOR_LIVE_UNVERIFIED,
  CODES.IMPORT_INVALID,
  CODES.NOT_FOUND,
  /*
   * 账号类的「可恢复」按「换一个请求能不能过」判，不按「要不要重试」判：
   * 登录之后 `AUTH_REQUIRED` 就不再出现，刷新页面后 `CSRF_REJECTED` 就不再出现，
   * 等一会儿 `RATE_LIMITED` / `RESOURCE_EXHAUSTED` 就不再出现——都算可恢复。
   * `AUTH_REJECTED` 要换的是凭据或链接，也算换请求；只有 `FORBIDDEN` 换什么都没用。
   */
  CODES.AUTH_REQUIRED,
  CODES.AUTH_REJECTED,
  CODES.AUTH_UNAVAILABLE,
  CODES.CSRF_REJECTED,
  CODES.RATE_LIMITED,
  CODES.RESOURCE_EXHAUSTED
]);
var UNRECOVERABLE_CODES = /* @__PURE__ */ new Set([CODES.ONTOLOGY_INVALID, CODES.EXTENSION_INVALID, CODES.INTERNAL]);
function isRecoverableCode(code) {
  if (UNRECOVERABLE_CODES.has(code)) return false;
  return RECOVERABLE_CODES.has(code);
}

// ../mcs-web/core/formal/codec.mjs
var import_node_crypto = require("node:crypto");
var KERNEL_VERSION = "mcs-nd-subset/1";
var MAX_STEPS = 2e3;
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}
function pyStableString(value) {
  const json = JSON.stringify(canonicalize(value));
  let out = "";
  for (const ch of json) {
    const code = ch.codePointAt(0);
    if (code > 126) {
      if (code > 65535) {
        const offset = code - 65536;
        out += `\\u${(55296 + (offset >> 10)).toString(16)}\\u${(56320 + (offset & 1023)).toString(16)}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}
function digest(value) {
  return (0, import_node_crypto.createHash)("sha256").update(pyStableString(value), "utf8").digest("hex");
}

// ../mcs-web/core/formal/language.mjs
var TYPE_ALIASES = Object.freeze({
  o: "o",
  bool: "o",
  Bool: "o",
  Prop: "o",
  prop: "o",
  \u547D\u9898: "o",
  \u771F\u503C: "o",
  N: "N",
  Nat: "N",
  \u2115: "N",
  \u81EA\u7136\u6570: "N",
  R: "R",
  Real: "R",
  \u211D: "R",
  \u5B9E\u6570: "R",
  Set: "Set",
  \u96C6\u5408: "Set",
  Group: "Group",
  \u7FA4: "Group",
  Ring: "Ring",
  \u73AF: "Ring",
  Field: "Field",
  \u57DF: "Field",
  Top: "Top",
  \u62D3\u6251\u7A7A\u95F4: "Top",
  Manifold: "Manifold",
  \u6D41\u5F62: "Manifold",
  Tensor: "Tensor",
  \u5F20\u91CF: "Tensor",
  I: "I",
  \u533A\u95F4: "I",
  V: "V",
  "V*": "V*"
});
var FORMAL_OPERATORS = Object.freeze([
  { token: "=", alias: [], note: "\u76F8\u7B49\uFF1A\u5BF9\u8C61\u8BED\u8A00\u91CC\u662F\u903B\u8F91\u5E38\u5143 eq\uFF08\u8981\u5E26\u7C7B\u578B\u53C2\u6570\uFF09\uFF0C\u516C\u5F0F\u91CC\u5199\u4F5C x = y\u3002" },
  { token: "\u2227", alias: ["/\\", "and"], note: "\u5408\u53D6\u3002\u89C4\u8303\u5F62\u5F0F**\u4E0D\u91CD\u6392**\uFF1Aa \u2227 b \u2227 c \u53F3\u7ED3\u5408\uFF0C\u6362\u5E8F\u8981\u53E6\u51FA\u8BC1\u4E66\u3002" },
  { token: "\u21D2", alias: ["->", "=>", "imp"], note: "\u8574\u542B\uFF0C\u53F3\u7ED3\u5408\u3002" },
  { token: "\u21D4", alias: ["<=>", "iff"], note: "\u7B49\u4EF7\uFF0C\u5C55\u5F00\u4E3A\u4E24\u4E2A\u65B9\u5411\u7684\u8574\u542B\u7684\u5408\u53D6\u3002" },
  { token: "\xAC", alias: ["not"], note: "\u5426\u5B9A\uFF0C\u5C55\u5F00\u4E3A a \u21D2 false\u3002" },
  { token: "\u2200", alias: ["forall"], note: "\u5168\u79F0\u91CF\u8BCD\u3002\u8BC1\u4E66\u91CC\u7ED1\u5B9A\u53D8\u91CF\u6309\u51FA\u73B0\u6B21\u5E8F \u03B1 \u89C4\u8303\u4E3A z0, z1, \u2026\u3002" },
  { token: "\u2203", alias: ["exists"], note: "\u5B58\u5728\u91CF\u8BCD\u3002" },
  { token: "\u03BB", alias: ["lam"], note: "\u62BD\u8C61\uFF1B\u5185\u6838\u5F62\u72B6\u91CC\u7ED1\u5B9A\u53D8\u91CF\u7528 de Bruijn\uFF0C\u6539\u540D\u4E0D\u6539\u53D8\u89C4\u8303\u5F62\u5F0F\u3002" },
  { token: "let", alias: [], note: "\u5C40\u90E8\u7F29\u5199\uFF0C\u89E3\u6790\u671F\u76F4\u63A5\u4EE3\u5165\u6D88\u53BB\uFF0C\u4E0D\u4EA7\u751F \u03B2 \u6B65\u3002" },
  { token: "true", alias: [], note: "\u771F\u503C\u5E38\u5143\uFF08\u5BF9\u8C61\u8BED\u8A00\uFF0C\u7C7B\u578B o\uFF09\u3002\u516C\u5F0F\u91CC\u7684 \u22A4 \u5199\u6210 t = true\uFF0C\u5373 B(t)\u3002" },
  { token: "false", alias: [], note: "\u516C\u5F0F\u8BED\u8A00\u7684\u5047\uFF1B\u5185\u6838\u6CA1\u6709 false_e\uFF0C\u56E0\u6B64 false \u53EA\u80FD\u4F5C\u4E3A\u7ED3\u8BBA\u4EE5\u5916\u7684\u4F4D\u7F6E\u51FA\u73B0\u3002" },
  { token: "\u2228", alias: ["or"], note: "**\u4E0D\u63A5\u53D7**\uFF1A\u5185\u6838\u6CA1\u6709\u6790\u53D6\u89C4\u5219\uFF0C\u62A5 unsupported\uFF0C\u4E0D\u5047\u88C5\u80FD\u8BC1\u3002", rejected: true }
]);
var FORMAL_BOUNDED_TYPES = Object.freeze([
  { name: "o", note: "\u771F\u503C\u7C7B\u578B\uFF0C\u5FC5\u987B\u5B58\u5728\u3002" },
  { name: "Set", note: "\u5BF9\u8C61\u96C6/\u8F7D\u4F53\uFF0C\u53EF\u4F5C\u7C7B\u578B\u539F\u5B50\u4F7F\u7528\u3002" },
  { name: "I", note: "\u4E2A\u4F53/\u6307\u6807\u7C7B\u578B\uFF0C\u4EE3\u6570\u80CC\u666F\u91CC\u7684\u9ED8\u8BA4\u57FA\u5E95\u3002" },
  { name: "G", note: "\u7FA4\u8F7D\u4F53\uFF1B\u7FA4\u80CC\u666F `bg:group/1` \u9884\u7F6E\u3002" },
  { name: "N", note: "\u81EA\u7136\u6570\uFF1A\u53EA\u505A\u7B26\u53F7\u63A8\u7406\uFF0C\u4E0D\u4EE5\u6709\u9650\u6837\u672C\u5192\u5145\u5B8C\u6574\u6A21\u578B\u3002" },
  { name: "R", note: "\u5B9E\u6570\uFF1A\u540C\u4E0A\uFF0C\u6709\u9650\u53CD\u6A21\u578B\u4E0D\u63A8\u7FFB\u5B9E\u6570\u7ED3\u8BBA\u3002" },
  { name: "V", note: "\u5411\u91CF\u7A7A\u95F4\u8F7D\u4F53\uFF1B\u5F20\u91CF\u80CC\u666F\u9884\u7F6E\u3002" },
  { name: "M", note: "\u6D41\u5F62\u8F7D\u4F53\uFF1B\u6D41\u5F62\u80CC\u666F\u9884\u7F6E\u3002" }
]);
var FORMAL_BUDGETS = Object.freeze({
  maxCandidates: 100,
  perCandidateMs: 2e3,
  totalMs: 3e4,
  depth: 8,
  maxStates: 1e4
});
var IDENT_RE = /[\p{L}_][\p{L}\p{N}_'′₀-₉]*/uy;
var SYMBOLS = Object.freeze(["<=>", "->", "=>", "/\\", "\u2227", "\u2228", "\u21D2", "\u21D4", "\u2200", "\u2203", "\xAC", "\u03BB", "(", ")", ",", ".", ":", "=", "\xB7"]);
var FORMULA_KEYWORDS = /* @__PURE__ */ new Set(["forall", "exists", "iff", "or", "in", "def"]);
var LOGIC_CONSTANTS = Object.freeze({ true: null, false: null, not: null, and: null, imp: null, eq: true, all: true, ex: true });
var REJECTED_IN_TERM = Object.freeze({
  or: "\u9996\u7248\u4E0D\u63A5\u53D7\u6790\u53D6\uFF1A\u5185\u6838\u6CA1\u6709 or \u7684\u5F15\u5165/\u6D88\u53BB\u89C4\u5219\u3002",
  iff: "\u9879\u8BED\u8A00\u91CC\u6CA1\u6709 \u21D4\uFF1B\u8BF7\u5728\u516C\u5F0F\u91CC\u5199 \u21D4\uFF0C\u6216\u76F4\u63A5\u7528 and(imp(a,b), imp(b,a))\u3002",
  forall: "\u9879\u8BED\u8A00\u91CC\u6CA1\u6709 \u2200\uFF1B\u8BF7\u7528 all(T)(P) \u6216\u6539\u7528\u516C\u5F0F\u3002",
  exists: "\u9879\u8BED\u8A00\u91CC\u6CA1\u6709 \u2203\uFF1B\u8BF7\u7528 ex(T)(P) \u6216\u6539\u7528\u516C\u5F0F\u3002"
});
function failAt(message, position, reason, extra = void 0) {
  throw new McsError(CODES.BAD_REQUEST, message, 400, {
    line: position?.line ?? null,
    column: position?.column ?? null,
    token: position?.token ?? null,
    ...reason ? { reason } : {},
    ...extra ?? {}
  });
}
function tokenPosition(tok) {
  return { line: tok?.line ?? null, column: tok?.column ?? null, token: tok?.token ?? null };
}
function describeToken(tok) {
  if (!tok || tok.kind === "eof") return "\u8F93\u5165\u7ED3\u675F";
  return `\u201C${tok.token}\u201D`;
}
function shiftPosition(pos, base) {
  if (!base || typeof base !== "object") return pos;
  const line = (base.line ?? 1) + pos.line - 1;
  const column = pos.line === 1 ? (base.column ?? 1) + pos.column - 1 : pos.column;
  return { line, column, token: pos.token };
}
function tokenize(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const bump = (text) => {
    for (const ch of text) {
      if (ch === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
  };
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\n" || ch === " " || ch === "	" || ch === "\r") {
      index += 1;
      if (ch === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, index));
    if (symbol) {
      tokens.push({ kind: "symbol", value: symbol, token: symbol, line, column });
      index += symbol.length;
      bump(symbol);
      continue;
    }
    IDENT_RE.lastIndex = index;
    const match = IDENT_RE.exec(source);
    if (match && match.index === index) {
      tokens.push({ kind: "ident", value: match[0], token: match[0], line, column });
      index += match[0].length;
      bump(match[0]);
      continue;
    }
    failAt(`\u65E0\u6CD5\u8BC6\u522B\u7684\u5B57\u7B26 ${JSON.stringify(ch)}`, { line, column, token: ch }, "unexpected-token");
  }
  tokens.push({ kind: "eof", value: "", token: null, line, column });
  return tokens;
}
var MAX_NESTING = 256;
function makeParser(source, base) {
  let raw;
  try {
    raw = tokenize(String(source ?? ""));
  } catch (error) {
    if (base && error instanceof McsError && error.details) {
      throw new McsError(CODES.BAD_REQUEST, error.message, 400, { ...error.details, ...shiftPosition(error.details, base) });
    }
    throw error;
  }
  const tokens = base ? raw.map((tok) => ({ ...tok, ...shiftPosition(tok, base) })) : raw;
  let cursor = 0;
  const api = {
    get index() {
      return cursor;
    },
    set index(value) {
      cursor = value;
    },
    peek(offset = 0) {
      return tokens[Math.min(cursor + offset, tokens.length - 1)];
    },
    next() {
      const tok = tokens[cursor];
      if (cursor < tokens.length - 1) cursor += 1;
      return tok;
    },
    atSymbol(value) {
      const tok = api.peek();
      return tok.kind === "symbol" && tok.value === value;
    },
    atIdent(value) {
      const tok = api.peek();
      return tok.kind === "ident" && tok.value === value;
    },
    atEof() {
      return api.peek().kind === "eof";
    },
    expectSymbol(value, why) {
      const tok = api.peek();
      if (!(tok.kind === "symbol" && tok.value === value)) failAt(`${why}\uFF08\u5E94\u4E3A \u201C${value}\u201D\uFF0C\u5B9E\u9645\u662F ${describeToken(tok)}\uFF09`, tokenPosition(tok), "syntax");
      return api.next();
    },
    expectEof(what) {
      const tok = api.peek();
      if (tok.kind === "eof") return;
      const reason = tok.value === "\u2228" || tok.value === "or" ? "unsupported" : "syntax";
      failAt(`${what}\uFF1A\u591A\u4F59\u7684\u8BB0\u53F7 ${describeToken(tok)}${reason === "unsupported" ? "\u2014\u2014\u9996\u7248\u4E0D\u63A5\u53D7\u6790\u53D6\uFF08\u5185\u6838\u6CA1\u6709 or \u89C4\u5219\uFF09" : ""}`, tokenPosition(tok), reason);
    },
    /*
     * 嵌套深度守卫（2026-10 加）。
     *
     * 递归下降的每一层括号都要占栈：`"(".repeat(2000) + "P(x)" + ")".repeat(2000)`
     * 只有约 4 KB，远低于 2 MB 的请求体上限，却能稳定打出 `RangeError: Maximum call
     * stack size exceeded`——请求层把它包成 500「服务器内部错误」，用户看到的是
     * 「服务器坏了」，而不是「你写的表达式太深」。这里给一个软上限，
     * 超过就报 `resource_exhausted`（可恢复：少嵌几层再来）。
     */
    depth: 0,
    enter() {
      if (api.depth >= MAX_NESTING) failAt(`\u8868\u8FBE\u5F0F\u5D4C\u5957\u8FC7\u6DF1\uFF08\u8D85\u8FC7 ${MAX_NESTING} \u5C42\uFF09`, tokenPosition(api.peek()), "resource_exhausted");
      api.depth += 1;
    },
    leave() {
      api.depth = Math.max(0, api.depth - 1);
    }
  };
  return api;
}
function normalizeTypeAtom(name) {
  return Object.prototype.hasOwnProperty.call(TYPE_ALIASES, name) ? TYPE_ALIASES[name] : name;
}
function typeEquals(a, b) {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a[0] === b[0] && typeEquals(a[1], b[1]) && typeEquals(a[2], b[2]);
}
function typeToString(typeNode) {
  if (typeof typeNode === "string") return typeNode;
  if (isMetaType(typeNode)) return `?${typeNode.meta}`;
  if (!Array.isArray(typeNode) || typeNode[0] !== "->") return String(typeNode);
  const left = typeof typeNode[1] === "string" ? typeNode[1] : `(${typeToString(typeNode[1])})`;
  return `${left} -> ${typeToString(typeNode[2])}`;
}
function parseTypeExpr(p) {
  p.enter();
  try {
    const left = parseTypeAtom(p);
    if (p.atSymbol("->")) {
      p.next();
      return ["->", left, parseTypeExpr(p)];
    }
    return left;
  } finally {
    p.leave();
  }
}
function parseTypeAtom(p) {
  const tok = p.peek();
  if (tok.kind === "symbol" && tok.value === "(") {
    p.enter();
    try {
      p.next();
      const inner = parseTypeExpr(p);
      p.expectSymbol(")", "\u7C7B\u578B\u7F3A\u5C11\u53F3\u62EC\u53F7");
      return inner;
    } finally {
      p.leave();
    }
  }
  if (tok.kind === "ident") {
    p.next();
    return normalizeTypeAtom(tok.value);
  }
  failAt(`\u7C7B\u578B\u89E3\u6790\uFF1A\u610F\u5916\u7684\u8BB0\u53F7 ${describeToken(tok)}`, tokenPosition(tok), "syntax");
  return null;
}
function parseType(source, position) {
  const p = makeParser(source, position);
  const node2 = parseTypeExpr(p);
  p.expectEof("\u7C7B\u578B\u89E3\u6790");
  return node2;
}
var isMetaType = (t) => Boolean(t) && typeof t === "object" && !Array.isArray(t) && Number.isInteger(t.meta);
var META_SEQUENCE = 0;
function isArrow(t) {
  return Array.isArray(t) && t[0] === "->";
}
function coerceTypeNode(value) {
  if (typeof value !== "string") return value;
  return /[->()]/.test(value) ? parseType(value) : value;
}
function makeScope(ctx = {}) {
  const constants = /* @__PURE__ */ new Map();
  const definitions = /* @__PURE__ */ new Map();
  for (const [name, type] of Object.entries(ctx.constants ?? {})) constants.set(name, coerceTypeNode(type));
  for (const def of ctx.definitions ?? []) {
    if (!def || typeof def.name !== "string") continue;
    const type = coerceTypeNode(def.type);
    if (type) definitions.set(def.name, type);
  }
  return {
    bases: [...ctx.bases ?? []],
    constants,
    definitions,
    strict: ctx.strict === true,
    /** 元变量位置表：id -> {line, column, token, why}（全局唯一 id，回退时无需清理）。 */
    metaPos: /* @__PURE__ */ new Map(),
    constraints: [],
    /** 自由变量表：name -> { term, pos }，同名共用同一个 `['v',…]` 节点。 */
    free: /* @__PURE__ */ new Map(),
    /** λ/let 绑定栈（de Bruijn 只数这一栈）。 */
    bound: [],
    /** 公式量词绑定栈（具名，内核的公式语言就是这么存的）。 */
    named: [],
    usedNames: /* @__PURE__ */ new Set([...constants.keys(), ...definitions.keys()]),
    /** 节点 -> 记号位置。WeakMap 不参与序列化，也不影响哈希。 */
    pos: /* @__PURE__ */ new WeakMap()
  };
}
function freshMetaType(scope, position, why) {
  const id = META_SEQUENCE;
  META_SEQUENCE += 1;
  scope.metaPos.set(id, { ...position ?? {}, why });
  return { meta: id };
}
function positionOf(scope, node2) {
  return scope.pos.get(node2) ?? null;
}
function snapshotState(p, scope) {
  return {
    index: p.index,
    constraints: scope.constraints.length,
    bound: scope.bound.length,
    named: scope.named.length,
    free: new Map(scope.free),
    usedNames: new Set(scope.usedNames)
  };
}
function restoreState(p, scope, snap) {
  p.index = snap.index;
  scope.constraints.length = snap.constraints;
  scope.bound.length = snap.bound;
  scope.named.length = snap.named;
  scope.free = snap.free;
  scope.usedNames = snap.usedNames;
}
function resolveTypeTree(type, subst) {
  if (isMetaType(type)) {
    const bound = subst.get(type.meta);
    return bound === void 0 ? type : resolveTypeTree(bound, subst);
  }
  if (isArrow(type)) return ["->", resolveTypeTree(type[1], subst), resolveTypeTree(type[2], subst)];
  return type;
}
function occursIn(meta, type, subst) {
  const resolved = resolveTypeTree(type, subst);
  if (isMetaType(resolved)) return resolved.meta === meta.meta;
  if (isArrow(resolved)) return occursIn(meta, resolved[1], subst) || occursIn(meta, resolved[2], subst);
  return false;
}
function unifyTypes(left, right, subst, position, context) {
  const a = resolveTypeTree(left, subst);
  const b = resolveTypeTree(right, subst);
  if (isMetaType(a) && isMetaType(b) && a.meta === b.meta) return;
  if (isMetaType(a)) {
    if (occursIn(a, b, subst)) failAt(`\u7C7B\u578B\u65B9\u7A0B\u65E0\u89E3\uFF08\u81EA\u6307\uFF09\uFF1A${typeToString(a)} = ${typeToString(b)}`, position, "type-mismatch", { context });
    subst.set(a.meta, b);
    return;
  }
  if (isMetaType(b)) {
    if (occursIn(b, a, subst)) failAt(`\u7C7B\u578B\u65B9\u7A0B\u65E0\u89E3\uFF08\u81EA\u6307\uFF09\uFF1A${typeToString(a)} = ${typeToString(b)}`, position, "type-mismatch", { context });
    subst.set(b.meta, a);
    return;
  }
  if (typeof a === "string" || typeof b === "string") {
    if (a !== b) failAt(`\u7C7B\u578B\u4E0D\u5339\u914D\uFF1A${typeToString(a)} \u2260 ${typeToString(b)}`, position, "type-mismatch", { context });
    return;
  }
  unifyTypes(a[1], b[1], subst, position, context);
  unifyTypes(a[2], b[2], subst, position, context);
}
function solveConstraints(scope) {
  const subst = /* @__PURE__ */ new Map();
  for (const constraint of scope.constraints) {
    try {
      unifyTypes(constraint.left, constraint.right, subst, constraint.position, constraint.context);
    } catch (error) {
      if (constraint.variableName && error instanceof McsError) {
        throw new McsError(CODES.BAD_REQUEST, `\u540C\u4E00\u81EA\u7531\u8BED\u5883\u91CC\u540C\u540D\u5F02\u7C7B\u578B\uFF1A${constraint.variableName}\uFF08${error.message}\uFF09`, 400, {
          ...error.details,
          reason: "type-mismatch",
          variable: constraint.variableName
        });
      }
      throw error;
    }
  }
  return subst;
}
function logicalTypeOf(node2) {
  const op = node2[1];
  if (["true", "false", "not", "and", "or", "imp"].includes(op)) {
    return {
      true: "o",
      false: "o",
      not: ["->", "o", "o"],
      and: ["->", "o", ["->", "o", "o"]],
      or: ["->", "o", ["->", "o", "o"]],
      imp: ["->", "o", ["->", "o", "o"]]
    }[op];
  }
  const atom = node2[2];
  if (op === "eq") return ["->", atom, ["->", atom, "o"]];
  return ["->", ["->", atom, "o"], "o"];
}
function inferTermType(node2, scope, constraints) {
  if (!Array.isArray(node2)) failAt("\u7C7B\u578B\u63A8\u65AD\uFF1A\u4E0D\u662F\u5408\u6CD5\u7684\u9879", null, "syntax");
  switch (node2[0]) {
    case "v":
      return node2[2];
    case "b":
      return node2[2];
    case "c": {
      const type = scope.constants.get(node2[1]) ?? scope.definitions.get(node2[1]);
      if (!type) failAt(`\u672A\u58F0\u660E\u7684\u5E38\u91CF ${node2[1]}`, positionOf(scope, node2), "unknown-symbol");
      return type;
    }
    case "logic":
      return logicalTypeOf(node2);
    case "lam":
      return ["->", node2[1], inferTermType(node2[2], scope, constraints)];
    case "app": {
      const head = inferTermType(node2[1], scope, constraints);
      const arg = inferTermType(node2[2], scope, constraints);
      const result = freshMetaType(scope, positionOf(scope, node2), "\u5E94\u7528\u7684\u7ED3\u679C\u7C7B\u578B");
      const argumentName = node2[2]?.[0] === "v" && scope.free.has(node2[2][1]) ? node2[2][1] : null;
      constraints.push({ left: head, right: ["->", arg, result], position: positionOf(scope, node2), context: "\u5E94\u7528", variableName: argumentName });
      return result;
    }
    case "lift": {
      if (node2[1] && node2[1][0] === "lam") return inferTermType(node2[1], scope, constraints);
      failAt("lift \u7684\u7B2C\u4E00\u4E2A\u5206\u91CF\u5FC5\u987B\u662F \u03BB \u62BD\u8C61", positionOf(scope, node2), "type-mismatch");
      return null;
    }
    default:
      failAt(`\u4E0D\u652F\u6301\u7684\u9879\u6784\u9020\u5B50 ${String(node2[0])}`, positionOf(scope, node2), "unsupported");
      return null;
  }
}
function applyTypes(node2, subst, scope) {
  if (!Array.isArray(node2)) return node2;
  const resolve = (type, node_) => {
    const out = resolveTypeTree(type, subst);
    const pending = firstPendingMeta(out);
    if (pending !== null) {
      const where = scope.metaPos.get(pending) ?? positionOf(scope, node_);
      failAt(`\u65E0\u6CD5\u63A8\u65AD\u7C7B\u578B${where?.why ? `\uFF08${where.why}\uFF09` : ""}\uFF1A\u8BF7\u5199\u7C7B\u578B\u6CE8\u91CA\uFF0C\u4F8B\u5982 \u201Cx : G\u201D`, where, "undeclared-type");
    }
    return out;
  };
  switch (node2[0]) {
    case "v":
    case "b":
      return [node2[0], node2[1], resolve(node2[2], node2)];
    case "c":
      return node2;
    case "logic":
      return node2.length > 2 ? ["logic", node2[1], resolve(node2[2], node2)] : node2;
    case "lam":
      return ["lam", resolve(node2[1], node2), applyTypes(node2[2], subst, scope)];
    case "app":
      return ["app", applyTypes(node2[1], subst, scope), applyTypes(node2[2], subst, scope)];
    case "lift":
      return ["lift", applyTypes(node2[1], subst, scope), node2[2].map((param) => applyTypes(param, subst, scope))];
    case "eq":
      return ["eq", applyTypes(node2[1], subst, scope), applyTypes(node2[2], subst, scope)];
    case "and":
    case "or":
    case "imp":
      return [node2[0], applyTypes(node2[1], subst, scope), applyTypes(node2[2], subst, scope)];
    case "all":
    case "ex":
      return [node2[0], [node2[1][0], node2[1][1], resolve(node2[1][2], node2[1])], applyTypes(node2[2], subst, scope)];
    case "false":
      return node2;
    default:
      return node2;
  }
}
function firstPendingMeta(type) {
  if (isMetaType(type)) return type.meta;
  if (isArrow(type)) return firstPendingMeta(type[1]) ?? firstPendingMeta(type[2]);
  return null;
}
var LAM_NAME_HINTS = /* @__PURE__ */ new WeakMap();
function isFormulaKeyword(name) {
  return FORMULA_KEYWORDS.has(name);
}
function startsAtom(p) {
  const tok = p.peek();
  if (tok.kind === "symbol") return tok.value === "(" || tok.value === "\u03BB";
  if (tok.kind !== "ident") return false;
  const name = tok.value;
  if (name === "lam" || name === "let") return true;
  if (name === "and" || name === "imp" || name === "not") {
    const after = p.peek(1);
    return after.kind === "symbol" && after.value === "(";
  }
  if (isFormulaKeyword(name) || name === "or") return false;
  return true;
}
function hasTopLevelComma(p) {
  let depth = 0;
  for (let offset = 0; offset < 4096; offset += 1) {
    const tok = p.peek(offset);
    if (tok.kind === "eof") return false;
    if (tok.kind === "symbol") {
      if (tok.value === "(") depth += 1;
      else if (tok.value === ")") {
        depth -= 1;
        if (depth === 0) return false;
      } else if (tok.value === "," && depth === 1) return true;
    }
  }
  return false;
}
function makeApp(head, arg, scope, position) {
  const node2 = ["app", head, arg];
  if (position) scope.pos.set(node2, position);
  return node2;
}
function resolveIdentifier(tok, scope) {
  const name = tok.value;
  for (let i = scope.bound.length - 1; i >= 0; i -= 1) {
    if (scope.bound[i].name === name) return ["b", scope.bound.length - 1 - i, scope.bound[i].type];
  }
  for (let i = scope.named.length - 1; i >= 0; i -= 1) {
    const entry = scope.named[i];
    if (entry.name === name || entry.source === name) return ["v", entry.name, entry.type];
  }
  if (Object.prototype.hasOwnProperty.call(REJECTED_IN_TERM, name)) {
    failAt(`\u9879\u8BED\u8A00\u4E0D\u63A5\u53D7 \u201C${name}\u201D\uFF1A${REJECTED_IN_TERM[name]}`, tokenPosition(tok), "unsupported");
  }
  if (Object.prototype.hasOwnProperty.call(LOGIC_CONSTANTS, name)) {
    if (LOGIC_CONSTANTS[name] === true) {
      const node3 = ["logic", name, freshMetaType(scope, tokenPosition(tok), `\u903B\u8F91\u5E38\u5143 ${name} \u7684\u7C7B\u578B\u53C2\u6570`)];
      scope.pos.set(node3, tokenPosition(tok));
      return node3;
    }
    return ["logic", name];
  }
  if (scope.constants.has(name)) return ["c", name];
  if (scope.definitions.has(name)) return ["c", name];
  const existing = scope.free.get(name);
  if (existing) return existing.term;
  const node2 = ["v", name, freshMetaType(scope, tokenPosition(tok), `\u81EA\u7531\u53D8\u91CF ${name}`)];
  scope.free.set(name, { term: node2, pos: tokenPosition(tok) });
  scope.usedNames.add(name);
  scope.pos.set(node2, tokenPosition(tok));
  return node2;
}
function isFormulaStart(p) {
  const tok = p.peek();
  if (tok.kind === "symbol") return tok.value === "\u2200" || tok.value === "\u2203" || tok.value === "\xAC";
  if (tok.kind !== "ident") return false;
  if (tok.value === "forall" || tok.value === "exists") return true;
  if (tok.value === "not") return !(p.peek(1).kind === "symbol" && p.peek(1).value === "(");
  return false;
}
function parseTermAtom(p, scope, expected) {
  const tok = p.peek();
  if (expected === "o" && isFormulaStart(p)) {
    const formula = parseFormulaExpr(p, scope);
    return formulaToTerm(formula, { bases: scope.bases, constants: Object.fromEntries(scope.constants) });
  }
  if (tok.kind === "symbol" && tok.value === "(") {
    p.enter();
    try {
      p.next();
      const inner = parseTermExpr(p, scope, expected);
      p.expectSymbol(")", "\u9879\u7F3A\u5C11\u53F3\u62EC\u53F7");
      return inner;
    } finally {
      p.leave();
    }
  }
  if (tok.kind === "symbol" && tok.value === "\u03BB") return parseAbstraction(p, scope, expected);
  if (tok.kind === "ident") {
    if (tok.value === "let") return parseLet(p, scope, expected);
    if (tok.value === "lam") return parseAbstraction(p, scope, expected);
    if ((tok.value === "and" || tok.value === "imp" || tok.value === "not") && !(p.peek(1).kind === "symbol" && p.peek(1).value === "(")) {
      failAt(`\u903B\u8F91\u5E38\u5143 \u201C${tok.value}\u201D \u9700\u8981\u53C2\u6570\uFF0C\u5199\u6210 ${tok.value}(\u2026)`, tokenPosition(tok), "syntax");
    }
    p.next();
    const node2 = resolveIdentifier(tok, scope);
    if (node2[0] === "b" || node2[0] === "c") return node2;
    return node2;
  }
  failAt(`\u9879\u89E3\u6790\uFF1A\u610F\u5916\u7684\u8BB0\u53F7 ${describeToken(tok)}`, tokenPosition(tok), "syntax");
  return null;
}
function parseTermExpr(p, scope, expected) {
  p.enter();
  try {
    let head = parseTermAtom(p, scope, expected);
    for (; ; ) {
      const tok = p.peek();
      if (tok.kind === "symbol" && tok.value === "(" && hasTopLevelComma(p)) {
        const at = tokenPosition(tok);
        p.next();
        while (!p.atSymbol(")")) {
          const arg = parseTermExpr(p, scope, null);
          head = makeApp(head, arg, scope, at);
          if (p.atSymbol(",")) {
            p.next();
            continue;
          }
          break;
        }
        p.expectSymbol(")", "\u53C2\u6570\u8868\u7F3A\u5C11\u53F3\u62EC\u53F7");
        continue;
      }
      if (startsAtom(p)) {
        const at = tokenPosition(p.peek());
        const arg = parseTermAtom(p, scope, null);
        head = makeApp(head, arg, scope, at);
        continue;
      }
      break;
    }
    return head;
  } finally {
    p.leave();
  }
}
function parseBinders(p, scope, what) {
  const binders = [];
  for (; ; ) {
    const tok = p.peek();
    if (tok.kind === "symbol" && tok.value === "(") {
      p.next();
      const nameTok = p.peek();
      if (nameTok.kind !== "ident") failAt(`${what}\uFF1A\u62EC\u53F7\u91CC\u9700\u8981\u53D8\u91CF\u540D`, tokenPosition(nameTok), "syntax");
      p.next();
      let type = null;
      if (p.atSymbol(":")) {
        p.next();
        type = parseTypeExpr(p);
      }
      p.expectSymbol(")", `${what}\u7684\u7ED1\u5B9A\u7F3A\u5C11\u53F3\u62EC\u53F7`);
      binders.push({ name: nameTok.value, type, pos: tokenPosition(nameTok) });
      continue;
    }
    if (tok.kind === "ident" && !isFormulaKeyword(tok.value) && tok.value !== "let" && tok.value !== "lam") {
      p.next();
      let type = null;
      if (p.atSymbol(":")) {
        p.next();
        type = parseTypeExpr(p);
      }
      binders.push({ name: tok.value, type, pos: tokenPosition(tok) });
      continue;
    }
    break;
  }
  if (binders.length === 0) failAt(`${what}\u9700\u8981\u81F3\u5C11\u4E00\u4E2A\u7ED1\u5B9A\u53D8\u91CF`, tokenPosition(p.peek()), "syntax");
  return binders;
}
function parseAbstraction(p, scope, expected) {
  p.next();
  const binders = parseBinders(p, scope, "\u03BB \u62BD\u8C61");
  p.expectSymbol(".", "\u03BB \u7ED1\u5B9A\u4E4B\u540E\u9700\u8981 \u201C.\u201D");
  const pushed = [];
  binders.forEach((binder, offset) => {
    let type = binder.type;
    if (!type) {
      let hint = expected;
      for (let i = 0; i <= offset && isArrow(hint); i += 1) hint = i === offset ? hint[1] : hint[2];
      type = isArrow(hint) || typeof hint === "string" ? hint : freshMetaType(scope, binder.pos, `\u03BB \u7ED1\u5B9A ${binder.name}`);
    }
    scope.bound.push({ name: binder.name, type });
    pushed.push({ name: binder.name, type, pos: binder.pos });
  });
  let body;
  try {
    body = parseTermExpr(p, scope, isArrow(expected) ? expected[2] : null);
  } finally {
    scope.bound.length -= pushed.length;
  }
  let out = body;
  for (let i = pushed.length - 1; i >= 0; i -= 1) {
    const node2 = ["lam", pushed[i].type, out];
    LAM_NAME_HINTS.set(node2, pushed[i].name);
    out = node2;
  }
  return out;
}
function parseLet(p, scope, expected) {
  p.next();
  const nameTok = p.peek();
  if (nameTok.kind !== "ident") failAt("let \u9700\u8981\u4E00\u4E2A\u53D8\u91CF\u540D", tokenPosition(nameTok), "syntax");
  p.next();
  p.expectSymbol("=", "let \u9700\u8981 \u201C=\u201D");
  const value = parseTermExpr(p, scope, null);
  if (!p.atIdent("in")) failAt(`let \u9700\u8981 \u201Cin\u201D\uFF08\u5B9E\u9645\u662F ${describeToken(p.peek())}\uFF09`, tokenPosition(p.peek()), "syntax");
  p.next();
  const type = inferTermType(value, scope, scope.constraints);
  scope.bound.push({ name: nameTok.value, type });
  let body;
  try {
    body = parseTermExpr(p, scope, expected);
  } finally {
    scope.bound.length -= 1;
  }
  return openBodyLocal(body, value, 0);
}
function openBodyLocal(body, value, depth = 0) {
  if (!Array.isArray(body)) return body;
  if (body[0] === "b") {
    if (body[1] === depth) return shiftLocal(value, depth);
    return ["b", body[1] > depth ? body[1] - 1 : body[1], body[2]];
  }
  if (body[0] === "app") return ["app", openBodyLocal(body[1], value, depth), openBodyLocal(body[2], value, depth)];
  if (body[0] === "lam") return ["lam", body[1], openBodyLocal(body[2], value, depth + 1)];
  return body;
}
function shiftLocal(node2, amount, cutoff = 0) {
  if (!Array.isArray(node2)) return node2;
  if (node2[0] === "b") return ["b", node2[1] >= cutoff ? node2[1] + amount : node2[1], node2[2]];
  if (node2[0] === "app") return ["app", shiftLocal(node2[1], amount, cutoff), shiftLocal(node2[2], amount, cutoff)];
  if (node2[0] === "lam") return ["lam", node2[1], shiftLocal(node2[2], amount, cutoff + 1)];
  return node2;
}
var L = (name, type) => type === void 0 ? ["logic", name] : ["logic", name, type];
var B = (term) => ["eq", term, L("true")];
function freshenBinder(name, scope) {
  let candidate = name;
  let suffix = 1;
  const taken = (value) => scope.constants.has(value) || scope.definitions.has(value) || scope.named.some((entry) => entry.name === value) || scope.free.has(value) || Object.prototype.hasOwnProperty.call(LOGIC_CONSTANTS, value);
  while (taken(candidate) || scope.usedNames.has(candidate)) {
    candidate = `${name}_${suffix}`;
    suffix += 1;
    if (suffix > 1e3) break;
  }
  return candidate;
}
function parseQuantifier(p, scope, kind) {
  p.next();
  const binders = parseBinders(p, scope, kind === "all" ? "\u5168\u79F0\u91CF\u8BCD" : "\u5B58\u5728\u91CF\u8BCD");
  p.expectSymbol(".", "\u91CF\u8BCD\u7ED1\u5B9A\u4E4B\u540E\u9700\u8981 \u201C.\u201D");
  const pushed = [];
  for (const binder of binders) {
    const name = freshenBinder(binder.name, scope);
    const type = binder.type ?? freshMetaType(scope, binder.pos, `\u91CF\u8BCD\u7ED1\u5B9A ${binder.name}`);
    scope.named.push({ name, type, source: binder.name });
    scope.usedNames.add(name);
    pushed.push({ name, type, pos: binder.pos });
  }
  let body;
  try {
    body = parseFormulaExpr(p, scope);
  } finally {
    scope.named.length -= pushed.length;
  }
  let out = body;
  for (let i = pushed.length - 1; i >= 0; i -= 1) {
    out = [kind, ["v", pushed[i].name, pushed[i].type], out];
  }
  return out;
}
function parseNot(p, scope) {
  if (p.atSymbol("\xAC") || p.atIdent("not")) {
    p.next();
    return ["imp", parseNot(p, scope), ["false"]];
  }
  if (p.atSymbol("\u2200") || p.atIdent("forall")) return parseQuantifier(p, scope, "all");
  if (p.atSymbol("\u2203") || p.atIdent("exists")) return parseQuantifier(p, scope, "ex");
  return parseFormulaAtom(p, scope);
}
function parseConjunction(p, scope) {
  const left = parseNot(p, scope);
  if (p.atSymbol("\u2227") || p.atSymbol("/\\") || p.atIdent("and")) {
    p.next();
    return ["and", left, parseConjunction(p, scope)];
  }
  return left;
}
function parseImplication(p, scope) {
  const left = parseConjunction(p, scope);
  if (p.atSymbol("\u21D2") || p.atSymbol("->") || p.atSymbol("=>") || p.atIdent("imp")) {
    p.next();
    return ["imp", left, parseImplication(p, scope)];
  }
  return left;
}
function parseEquivalence(p, scope) {
  let left = parseImplication(p, scope);
  while (p.atSymbol("\u21D4") || p.atSymbol("<=>") || p.atIdent("iff")) {
    p.next();
    const right = parseImplication(p, scope);
    left = ["and", ["imp", left, right], ["imp", right, left]];
  }
  return left;
}
function parseFormulaAtom(p, scope) {
  const tok = p.peek();
  if (tok.kind === "symbol" && tok.value === "\u2228") {
    failAt("\u9996\u7248\u4E0D\u63A5\u53D7\u6790\u53D6\uFF1A\u5185\u6838\u6CA1\u6709 or \u7684\u5F15\u5165/\u6D88\u53BB\u89C4\u5219\u3002", tokenPosition(tok), "unsupported");
  }
  if (tok.kind === "ident" && tok.value === "or") {
    failAt("\u9996\u7248\u4E0D\u63A5\u53D7\u6790\u53D6\uFF1A\u5185\u6838\u6CA1\u6709 or \u7684\u5F15\u5165/\u6D88\u53BB\u89C4\u5219\u3002", tokenPosition(tok), "unsupported");
  }
  if (tok.kind === "ident" && (tok.value === "true" || tok.value === "false")) {
    p.next();
    return tok.value === "false" ? ["false"] : ["eq", L("true"), L("true")];
  }
  if (tok.kind === "symbol" && tok.value === "(") {
    const snap = snapshotState(p, scope);
    p.enter();
    try {
      p.next();
      const inner = parseFormulaExpr(p, scope);
      p.expectSymbol(")", "\u516C\u5F0F\u7F3A\u5C11\u53F3\u62EC\u53F7");
      return inner;
    } catch (error) {
      if (!(error instanceof McsError)) throw error;
      if (error.details?.reason === "resource_exhausted" || /嵌套过深/.test(error.message)) throw error;
      restoreState(p, scope, snap);
    } finally {
      p.leave();
    }
  }
  const leftTerm = parseTermExpr(p, scope, null);
  if (p.atSymbol("=")) {
    p.next();
    const rightTerm = parseTermExpr(p, scope, null);
    return ["eq", leftTerm, rightTerm];
  }
  const type = inferTermType(leftTerm, scope, scope.constraints);
  const resolved = resolveTypeTree(type, solveConstraints(scope));
  if (resolved === "o") return B(leftTerm);
  const at = positionOf(scope, leftTerm) ?? tokenPosition(tok);
  if (isMetaType(resolved)) {
    failAt("\u516C\u5F0F\u4F4D\u7F6E\u9700\u8981\u4E00\u4E2A\u771F\u503C\u9879\uFF08o\uFF09\uFF1B\u8FD9\u91CC\u63A8\u65AD\u4E0D\u51FA\u7C7B\u578B\uFF0C\u8BF7\u4E3A\u76F8\u5173\u7B26\u53F7\u58F0\u660E\u7C7B\u578B\uFF0C\u6216\u5199\u6210 \u201Ct = u\u201D \u7684\u7B49\u5F0F\u3002", at, "undeclared-type");
  }
  failAt(`\u516C\u5F0F\u4F4D\u7F6E\u9700\u8981\u4E00\u4E2A\u771F\u503C\u9879\uFF08o\uFF09\uFF0C\u8FD9\u91CC\u5F97\u5230 ${typeToString(resolved)}\uFF1B\u7B49\u5F0F\u8BF7\u5199\u6210 \u201Ct = u\u201D\u3002`, at, "type-mismatch");
  return null;
}
function parseFormulaExpr(p, scope) {
  return parseEquivalence(p, scope);
}
function inferCertType(node2, scope, constraints) {
  if (!Array.isArray(node2)) failAt("\u516C\u5F0F\u7C7B\u578B\u63A8\u65AD\uFF1A\u4E0D\u662F\u5408\u6CD5\u7684\u516C\u5F0F", null, "type-mismatch");
  const at = positionOf(scope, node2);
  switch (node2[0]) {
    case "false":
      return "o";
    case "eq": {
      const left = inferTermType(node2[1], scope, constraints);
      const right = inferTermType(node2[2], scope, constraints);
      constraints.push({ left, right, position: at, context: "\u7B49\u5F0F\u7684\u4E24\u8FB9" });
      return "o";
    }
    case "and":
    case "or":
    case "imp": {
      constraints.push({ left: inferCertType(node2[1], scope, constraints), right: "o", position: at, context: node2[0] });
      constraints.push({ left: inferCertType(node2[2], scope, constraints), right: "o", position: at, context: node2[0] });
      return "o";
    }
    case "all":
    case "ex": {
      constraints.push({ left: inferCertType(node2[2], scope, constraints), right: "o", position: at, context: "\u91CF\u8BCD\u4F53" });
      return "o";
    }
    default:
      failAt(`\u4E0D\u652F\u6301\u7684\u516C\u5F0F\u6784\u9020\u5B50 ${String(node2[0])}`, at, "unsupported");
      return null;
  }
}
function finishTerm(node2, scope, expected = null) {
  const type = inferTermType(node2, scope, scope.constraints);
  if (expected) scope.constraints.push({ left: type, right: expected, position: null, context: "\u671F\u671B\u7C7B\u578B" });
  const subst = solveConstraints(scope);
  return applyTypes(node2, subst, scope);
}
function finishFormula(node2, scope) {
  inferCertType(node2, scope, scope.constraints);
  const subst = solveConstraints(scope);
  return applyTypes(node2, subst, scope);
}
function parseTerm(source, ctx = {}) {
  const scope = makeScope(ctx);
  const p = makeParser(source, ctx.position);
  const node2 = parseTermExpr(p, scope, ctx.expected ?? null);
  p.expectEof("\u9879\u89E3\u6790");
  return finishTerm(node2, scope, ctx.expected ?? null);
}
function parseFormula(source, ctx = {}) {
  const scope = makeScope(ctx);
  const p = makeParser(source, ctx.position);
  const node2 = parseFormulaExpr(p, scope);
  p.expectEof("\u516C\u5F0F\u89E3\u6790");
  return finishFormula(node2, scope);
}
function formulaToTerm(formula, sig = { bases: ["o"], constants: {} }) {
  const scope = makeScope({ bases: sig.bases ?? ["o"], constants: sig.constants ?? {} });
  const typeOfTerm2 = (term) => {
    const constraints = [];
    const type = inferTermType(term, scope, constraints);
    return resolveTypeTree(type, solveConstraints({ constraints }));
  };
  const substTerm = (term, leafLambda, added, binders) => {
    if (!Array.isArray(term)) return term;
    switch (term[0]) {
      case "b":
        return term[1] >= leafLambda ? ["b", term[1] + added, term[2]] : term;
      case "v": {
        const declared = binders.get(term[1]);
        if (declared === void 0) return term;
        return ["b", leafLambda + added - declared - 1, term[2]];
      }
      case "app":
        return ["app", substTerm(term[1], leafLambda, added, binders), substTerm(term[2], leafLambda, added, binders)];
      case "lam":
        return ["lam", term[1], substTerm(term[2], leafLambda + 1, added, binders)];
      case "lift":
        return ["lift", substTerm(term[1], leafLambda, added, binders), term[2].map((param) => substTerm(param, leafLambda, added, binders))];
      default:
        return term;
    }
  };
  const encode = (node2, depth, binders) => {
    if (!Array.isArray(node2)) failAt("\u5D4C\u5165\uFF1A\u4E0D\u662F\u5408\u6CD5\u7684\u516C\u5F0F", null, "type-mismatch");
    const app3 = (head, arg) => ["app", head, arg];
    switch (node2[0]) {
      case "false":
        return L("false");
      case "eq":
        return app3(app3(L("eq", typeOfTerm2(node2[1])), substTerm(node2[1], 0, depth, binders)), substTerm(node2[2], 0, depth, binders));
      case "and":
      case "imp":
      case "or":
        return app3(app3(L(node2[0]), encode(node2[1], depth, binders)), encode(node2[2], depth, binders));
      case "all":
      case "ex": {
        const type = node2[1][2];
        const inner = new Map(binders);
        inner.set(node2[1][1], depth);
        return app3(L(node2[0], type), ["lam", type, encode(node2[2], depth + 1, inner)]);
      }
      default:
        failAt(`\u5D4C\u5165\uFF1A\u4E0D\u652F\u6301\u7684\u516C\u5F0F\u6784\u9020\u5B50 ${String(node2[0])}`, null, "unsupported");
        return null;
    }
  };
  return encode(formula, 0, /* @__PURE__ */ new Map());
}

// ../mcs-web/core/formal/terms.mjs
var FormalError = class extends Error {
  constructor(message, status = "failed") {
    super(message);
    this.name = "FormalError";
    this.status = status;
  }
};
function need(condition, message, status = "failed") {
  if (!condition) throw new FormalError(message, status);
  return true;
}
var arr = (a, b) => ["->", a, b];
var V = (name, type) => ["v", name, type];
var C = (name) => ["c", name];
var L2 = (name, type) => type === void 0 ? ["logic", name] : ["logic", name, type];
var App = (f, x) => ["app", f, x];
var Eq = (t, u) => ["eq", t, u];
var Imp = (a, b) => ["imp", a, b];
var And = (a, b) => ["and", a, b];
var All = (v, p) => ["all", v, p];
var Ex = (v, p) => ["ex", v, p];
var B2 = (t) => Eq(t, L2("true"));
var Iff = (a, b) => And(Imp(a, b), Imp(b, a));
var CONNECTIVES = /* @__PURE__ */ new Set(["imp", "and", "or"]);
var QUANTIFIERS = /* @__PURE__ */ new Set(["all", "ex"]);
var FORMULA_HEADS = /* @__PURE__ */ new Set(["eq", "false", "imp", "and", "or", "all", "ex"]);
function isCertFormula(node2) {
  return Array.isArray(node2) && typeof node2[0] === "string" && FORMULA_HEADS.has(node2[0]);
}
var isStr = (x) => typeof x === "string";
var isArr = (x) => Array.isArray(x);
function deepEqual(a, b) {
  if (a === b) return true;
  if (isStr(a) || isStr(b) || typeof a === "number" || typeof b === "number") return false;
  if (!isArr(a) || !isArr(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
  return true;
}
var TEXT_TYPE = /\s|->|→|⇒/;
function normalizeSig(sig) {
  need(sig && typeof sig === "object" && !isArr(sig), "sig \u5FC5\u987B\u662F\u5BF9\u8C61", "error");
  requireNoSpecShape(sig);
  let constants = sig.constants ?? sig.signature ?? null;
  let coerced = false;
  if (constants instanceof Map) {
    constants = Object.fromEntries(constants);
    coerced = true;
  } else if (isArr(constants)) {
    constants = Object.fromEntries(constants.map((c) => [c?.name ?? c?.[0], c?.type ?? c?.[1]]));
    coerced = true;
  }
  if (constants === null || constants === void 0) {
    constants = {};
    coerced = true;
  }
  need(typeof constants === "object" && !isArr(constants), "sig.constants \u5FC5\u987B\u662F\u300C\u540D\u5B57 \u2192 \u7C7B\u578B\u8282\u70B9\u300D\u5BF9\u8C61", "error");
  for (const [name, type] of Object.entries(constants)) {
    if (isStr(type) && TEXT_TYPE.test(type)) {
      throw new FormalError(
        `sig.constants.${name} \u7684\u7C7B\u578B\u662F\u6E90\u7801\u6587\u672C\u300C${type}\u300D\uFF0C\u8FD9\u662F**\u89E3\u6790\u5C42\u7B7E\u540D**\uFF08backgroundSignature \u7684\u5F62\u72B6\uFF09\u3002kernel \u53E3\u5F84\u7684 sig \u9700\u8981\u5DF2\u89E3\u6790\u7684\u7C7B\u578B\u8282\u70B9\uFF1B\u8BF7\u8D70 kernelInputForBackground() \u2192 buildKernelTheory() \u2192 signatureOfTheory()`,
        "error"
      );
    }
  }
  const basesGiven = isArr(sig.bases) && sig.bases.length > 0;
  const definitionsGiven = isArr(sig.definitions);
  if (!coerced && basesGiven && definitionsGiven) return sig;
  return {
    ...sig,
    bases: basesGiven ? sig.bases : ["o"],
    constants,
    definitions: definitionsGiven ? sig.definitions : []
  };
}
function requireNoSpecShape(sig) {
  const specish = ["declarations", "statement", "assumptions", "claims", "specVersion"];
  if (sig.constants !== void 0 || sig.signature !== void 0) return;
  const hit = specish.find((key) => sig[key] !== void 0);
  if (hit) {
    throw new FormalError(
      `\u8FD9\u770B\u8D77\u6765\u662F formalSpec\uFF08\u542B ${hit}\uFF09\uFF0C\u4E0D\u662F kernel \u53E3\u5F84\u7684 sig\u3002\u8BF7\u5148\u7528 buildKernelTheory(specs, { axioms }) \u88C5\u914D\u7406\u8BBA\uFF0C\u518D\u7528 signatureOfTheory(theory) \u53D6 sig`,
      "error"
    );
  }
}
var normalizedSigs = /* @__PURE__ */ new WeakMap();
function ensureSig(sig) {
  if (!sig || typeof sig !== "object" || isArr(sig)) return normalizeSig(sig);
  const cached = normalizedSigs.get(sig);
  if (cached) return cached;
  const normalized = normalizeSig(sig);
  normalizedSigs.set(sig, normalized);
  normalizedSigs.set(normalized, normalized);
  return normalized;
}
function typeOk(t, bases) {
  if (isStr(t)) {
    need(bases.includes(t), `undeclared base type: ${t}`);
  } else {
    need(isArr(t) && t.length === 3 && t[0] === "->", "invalid type");
    typeOk(t[1], bases);
    typeOk(t[2], bases);
  }
  return t;
}
function logicalType(t, bases) {
  const op = t[1];
  if (["true", "false", "not", "and", "or", "imp"].includes(op)) {
    need(t.length === 2, "unexpected logical parameter");
    return {
      true: "o",
      false: "o",
      not: arr("o", "o"),
      and: arr("o", arr("o", "o")),
      or: arr("o", arr("o", "o")),
      imp: arr("o", arr("o", "o"))
    }[op];
  }
  need(["eq", "all", "ex"].includes(op) && t.length === 3, "unknown logical constant");
  const a = typeOk(t[2], bases);
  return op === "eq" ? arr(a, arr(a, "o")) : arr(arr(a, "o"), "o");
}
function mergeVars(...maps) {
  const result = {};
  for (const m of maps) {
    for (const [n, t] of Object.entries(m)) {
      need(!(n in result) || deepEqual(result[n], t), `inconsistent free variable type: ${n}`);
      result[n] = t;
    }
  }
  return result;
}
function objectFv(t) {
  if (t[0] === "v") return { [t[1]]: t[2] };
  if (t[0] === "app") return mergeVars(objectFv(t[1]), objectFv(t[2]));
  if (t[0] === "lam") return objectFv(t[2]);
  return {};
}
function termFvCert(t) {
  if (t[0] === "v") return { [t[1]]: t[2] };
  if (t[0] === "app") return mergeVars(termFvCert(t[1]), termFvCert(t[2]));
  if (t[0] === "lift") return mergeVars(...t[2].map((u) => termFvCert(u)));
  return {};
}
function allNames(x) {
  if (!isArr(x)) return /* @__PURE__ */ new Set();
  if (x.length && x[0] === "v") return /* @__PURE__ */ new Set([x[1]]);
  const out = /* @__PURE__ */ new Set();
  for (const a of x) for (const n of allNames(a)) out.add(n);
  return out;
}
function fresh(names) {
  let i = 0;
  const has = (n) => names instanceof Set ? names.has(n) : names.includes(n);
  while (has(`z${i}`)) i += 1;
  return `z${i}`;
}
function canonical(t, env = []) {
  need(isArr(t) && t.length > 0 && isStr(t[0]), "invalid object term");
  const k = t[0];
  if (k === "lambda") {
    need(t.length === 4 && isStr(t[1]), "invalid named abstraction");
    return ["lam", t[2], canonical(t[3], [[t[1], t[2]], ...env])];
  }
  if (k === "v") {
    need(t.length === 3 && isStr(t[1]), "invalid variable");
    for (let i = 0; i < env.length; i += 1) {
      const [name, ty] = env[i];
      if (name === t[1]) {
        need(deepEqual(ty, t[2]), "bound variable type mismatch");
        return ["b", i, t[2]];
      }
    }
    return t;
  }
  if (k === "lam") {
    need(t.length === 3, "invalid canonical abstraction");
    return ["lam", t[1], canonical(t[2], [[null, t[1]], ...env])];
  }
  if (k === "app") {
    need(t.length === 3, "invalid application");
    return App(canonical(t[1], env), canonical(t[2], env));
  }
  need(["b", "c", "logic"].includes(k), "unsupported object syntax");
  return t;
}
function inferTerm(t, sig, bound = []) {
  sig = ensureSig(sig);
  need(isArr(t) && t.length > 0, "invalid term");
  const k = t[0];
  if (k === "v") {
    need(t.length === 3 && isStr(t[1]) && t[1] && !(t[1] in sig.constants), "invalid/overlapping variable");
    return typeOk(t[2], sig.bases);
  }
  if (k === "b") {
    need(t.length === 3 && Number.isInteger(t[1]) && t[1] >= 0 && t[1] < bound.length, "dangling bound variable");
    need(deepEqual(t[2], bound[t[1]]), "bound sort mismatch");
    return t[2];
  }
  if (k === "c") {
    need(t.length === 2 && t[1] in sig.constants, "undeclared constant");
    return sig.constants[t[1]];
  }
  if (k === "logic") return logicalType(t, sig.bases);
  if (k === "app") {
    need(t.length === 3, "application arity");
    const f = inferTerm(t[1], sig, bound);
    const x = inferTerm(t[2], sig, bound);
    need(isArr(f) && f[0] === "->" && deepEqual(f[1], x), "application type mismatch");
    return f[2];
  }
  if (k === "lam") {
    need(t.length === 3, "abstraction arity");
    const a = typeOk(t[1], sig.bases);
    return arr(a, inferTerm(t[2], sig, [a, ...bound]));
  }
  throw new FormalError(`object term constructor not supported: ${k}`, "unsupported");
}
function sourceTerm(t, sig) {
  const c = canonical(t);
  inferTerm(c, sig);
  objectFv(c);
  return c;
}
function shift(t, amount, cutoff = 0) {
  if (t[0] === "b") return ["b", t[1] >= cutoff ? t[1] + amount : t[1], t[2]];
  if (t[0] === "app") return App(shift(t[1], amount, cutoff), shift(t[2], amount, cutoff));
  if (t[0] === "lam") return ["lam", t[1], shift(t[2], amount, cutoff + 1)];
  return t;
}
function openBody(body, value, depth = 0) {
  if (body[0] === "b") {
    if (body[1] === depth) return shift(value, depth);
    return ["b", body[1] > depth ? body[1] - 1 : body[1], body[2]];
  }
  if (body[0] === "app") return App(openBody(body[1], value, depth), openBody(body[2], value, depth));
  if (body[0] === "lam") return ["lam", body[1], openBody(body[2], value, depth + 1)];
  return body;
}
function parameters(a) {
  const entries = Object.entries(objectFv(a));
  const nodes = entries.map(([n, t]) => V(n, t));
  return nodes.sort((x, y) => stableVarKey(x) < stableVarKey(y) ? -1 : stableVarKey(x) > stableVarKey(y) ? 1 : 0);
}
function stableVarKey(node2) {
  return `[${jsonText(node2[0])},${jsonText(node2[1])},${jsonText(node2[2])}]`;
}
function jsonText(value) {
  if (isStr(value)) {
    let out = '"';
    for (const ch of value) {
      const code = ch.codePointAt(0);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (code > 65535) {
        const h = Math.floor((code - 65536) / 1024) + 55296;
        const l = (code - 65536) % 1024 + 56320;
        out += `\\u${h.toString(16)}\\u${l.toString(16)}`;
      } else if (code > 127) out += `\\u${code.toString(16).padStart(4, "0")}`;
      else if (code < 32) out += `\\u${code.toString(16).padStart(4, "0")}`;
      else out += ch;
    }
    return `${out}"`;
  }
  if (isArr(value)) return `[${value.map(jsonText).join(",")}]`;
  return String(value);
}
function lift(t, sig) {
  const tt = sourceTerm(t, sig);
  if (tt[0] === "lam") return ["lift", tt, parameters(tt)];
  if (tt[0] === "app") return App(lift(tt[1], sig), lift(tt[2], sig));
  return tt;
}
function termType(t, sig) {
  need(isArr(t) && t.length > 0, "invalid certification term");
  if (t[0] === "lift") {
    need(t.length === 3 && isArr(t[2]), "lift arity");
    const a = sourceTerm(t[1], sig);
    need(deepEqual(a, t[1]) && a[0] === "lam", "lift identity must be canonical abstraction structure");
    const ps = parameters(a);
    need(ps.length === t[2].length, "lift parameter arity");
    for (let i = 0; i < ps.length; i += 1) {
      need(deepEqual(ps[i][2], termType(t[2][i], sig)), "lift parameter sort/order mismatch");
    }
    return inferTerm(a, sig);
  }
  if (t[0] === "app") {
    need(t.length === 3, "app arity");
    const f = termType(t[1], sig);
    const u = termType(t[2], sig);
    need(isArr(f) && f[0] === "->" && deepEqual(f[1], u), "sorted app mismatch");
    return f[2];
  }
  need(["v", "c", "logic"].includes(t[0]), "object/certification language confusion");
  return inferTerm(t, sig);
}
function formulaOk(f, sig) {
  sig = ensureSig(sig);
  need(isArr(f) && f.length > 0, "invalid certification formula");
  const k = f[0];
  if (k === "false") need(f.length === 1, "false arity");
  else if (k === "eq") {
    need(f.length === 3, "equality arity");
    need(deepEqual(termType(f[1], sig), termType(f[2], sig)), "equality sort mismatch");
    mergeVars(termFvCert(f[1]), termFvCert(f[2]));
  } else if (CONNECTIVES.has(k)) {
    need(f.length === 3, "connective arity");
    formulaOk(f[1], sig);
    formulaOk(f[2], sig);
  } else if (QUANTIFIERS.has(k)) {
    need(f.length === 3 && isArr(f[1]) && f[1][0] === "v", "quantifier binder");
    inferTerm(f[1], sig);
    formulaOk(f[2], sig);
    const fv = formulaFv(f[2]);
    need(!(f[1][1] in fv) || deepEqual(fv[f[1][1]], f[1][2]), "binder sort clash");
  } else throw new FormalError(`unsupported certification formula: ${k}`, "unsupported");
  formulaFv(f);
  return f;
}
function formulaFv(f) {
  const k = f[0];
  if (k === "eq") return mergeVars(termFvCert(f[1]), termFvCert(f[2]));
  if (CONNECTIVES.has(k)) return mergeVars(formulaFv(f[1]), formulaFv(f[2]));
  if (QUANTIFIERS.has(k)) {
    const body = formulaFv(f[2]);
    const out = {};
    for (const [n, t] of Object.entries(body)) if (n !== f[1][1]) out[n] = t;
    return out;
  }
  return {};
}
function termSub(t, v, u) {
  if (deepEqual(t, v)) return u;
  if (t[0] === "app") return App(termSub(t[1], v, u), termSub(t[2], v, u));
  if (t[0] === "lift") return ["lift", t[1], t[2].map((a) => termSub(a, v, u))];
  return t;
}
function fsub(f, v, u) {
  const k = f[0];
  if (k === "eq") return Eq(termSub(f[1], v, u), termSub(f[2], v, u));
  if (CONNECTIVES.has(k)) return [k, fsub(f[1], v, u), fsub(f[2], v, u)];
  if (QUANTIFIERS.has(k)) {
    if (deepEqual(f[1], v)) return f;
    let binder = f[1];
    let body = f[2];
    if (binder[1] in termFvCert(u)) {
      const renamed = V(fresh(/* @__PURE__ */ new Set([...allNames(f), ...allNames(u), v[1]])), binder[2]);
      body = fsub(body, binder, renamed);
      binder = renamed;
    }
    return [k, binder, fsub(body, v, u)];
  }
  return f;
}
function fcode(f, env = []) {
  const tc = (t) => {
    if (t[0] === "v") {
      for (let i = 0; i < env.length; i += 1) if (deepEqual(t, env[i])) return ["bound", i, t[2]];
    }
    if (t[0] === "app") return ["app", tc(t[1]), tc(t[2])];
    if (t[0] === "lift") return ["lift", t[1], t[2].map((a) => tc(a))];
    return t;
  };
  if (f[0] === "eq") return Eq(tc(f[1]), tc(f[2]));
  if (CONNECTIVES.has(f[0])) return [f[0], fcode(f[1], env), fcode(f[2], env)];
  if (QUANTIFIERS.has(f[0])) return [f[0], f[1][2], fcode(f[2], [f[1], ...env])];
  return f;
}
function sameFormula(a, b) {
  return deepEqual(fcode(a), fcode(b));
}
function close(vs, f) {
  let out = f;
  for (let i = vs.length - 1; i >= 0; i -= 1) out = All(vs[i], out);
  return out;
}
function formulaKey(f) {
  return JSON.stringify(fcode(f));
}
function subterms(node2, out = []) {
  if (!isArr(node2)) return out;
  out.push(node2);
  if (node2[0] === "lift") {
    out.push(node2[1]);
    for (const a of node2[2]) subterms(a, out);
    return out;
  }
  for (const a of node2) if (isArr(a)) subterms(a, out);
  return out;
}

// ../mcs-web/core/formal/certificate.mjs
var QUERY_RULES = [
  "hypothesis",
  "axiom",
  "theory",
  "definition",
  "lemma",
  "imp_i",
  "imp_e",
  "and_i",
  "and_l",
  "and_r",
  "refl",
  "eq_e",
  "all_i",
  "all_e",
  "ex_i",
  "ex_e"
];
var KERNEL_RULE_OF = {
  hypothesis: "assume",
  axiom: "h_axiom",
  theory: "theory",
  definition: "definition",
  lemma: "theorem",
  imp_i: "imp_i",
  imp_e: "imp_e",
  and_i: "and_i",
  and_l: "and_l",
  and_r: "and_r",
  refl: "refl",
  eq_e: "eq_e",
  all_i: "all_i",
  all_e: "all_e",
  ex_i: "ex_i",
  ex_e: "ex_e"
};
function axiomInstance(spec, sig) {
  sig = ensureSig(sig);
  const k = spec.schema;
  const p = V("p", "o");
  const q = V("q", "o");
  let f;
  if (k === "two_distinct") f = Imp(Eq(L2("true"), L2("false")), ["false"]);
  else if (k === "two_exhaustive") f = All(p, ["or", B2(p), Eq(p, L2("false"))]);
  else if (k === "logic") {
    const op = spec.op;
    need(["not", "and", "or", "imp"].includes(op), "unknown logical schema", "unsupported");
    if (op === "not") f = All(p, Iff(B2(App(L2(op), p)), Imp(B2(p), ["false"])));
    else f = close([p, q], Iff(B2(App(App(L2(op), p), q)), [op, B2(p), B2(q)]));
  } else if (k === "equality") {
    const a = typeOk(spec.type, sig.bases);
    const x = V("x", a);
    const y = V("y", a);
    f = close([x, y], Iff(B2(App(App(L2("eq", a), x), y)), Eq(x, y)));
  } else if (k === "quantifier") {
    const a = typeOk(spec.type, sig.bases);
    const op = spec.op;
    need(["all", "ex"].includes(op), "quantifier schema", "unsupported");
    const pred = V("P", arr(a, "o"));
    const x = V("x", a);
    f = All(pred, Iff(B2(App(L2(op, a), pred)), [op, x, B2(App(pred, x))]));
  } else if (k === "extensionality") {
    const a = typeOk(spec.domain, sig.bases);
    const b = typeOk(spec.codomain, sig.bases);
    const ff = V("f", arr(a, b));
    const g = V("g", arr(a, b));
    const x = V("x", a);
    f = close([ff, g], Imp(All(x, Eq(App(ff, x), App(g, x))), Eq(ff, g)));
  } else if (k === "abstraction") {
    const a = sourceTerm(spec.term, sig);
    need(a[0] === "lam", "abstraction schema requires lambda");
    const ps = parameters(a);
    const x = V(fresh(/* @__PURE__ */ new Set([...Object.keys(objectFv(a)), ...Object.keys(sig.constants)])), a[1]);
    f = close([...ps, x], Eq(App(lift(a, sig), x), lift(openBody(a[2], x), sig)));
  } else throw new FormalError(`unsupported axiom schema: ${spec}`, "unsupported");
  formulaOk(f, sig);
  need(Object.keys(formulaFv(f)).length === 0, "internal unclosed background axiom");
  return f;
}
function abstractionInstance(lamTerm, sig) {
  const a = sourceTerm(lamTerm, sig);
  need(a[0] === "lam", "abstraction instance requires lambda");
  return { schema: "abstraction", term: a };
}
var node = (rule, goal, extra = {}) => {
  need(QUERY_RULES.includes(rule), `unknown query rule: ${rule}`, "error");
  return { rule, goal, premises: extra.premises ?? [], ...extra };
};
function hypothesisNode(label, formula) {
  return node("hypothesis", formula, { hypothesis: { name: label, id: label } });
}
function axiomNode(spec, sig) {
  return node("axiom", axiomInstance(spec, sig), { instance: spec });
}
function theoryNode(axiomId, formula) {
  return node("theory", formula, { theoryAxiomId: axiomId });
}
function definitionNode(name, formula) {
  return node("definition", formula, { definitionName: name });
}
function lemmaNode(lemmaId, formula) {
  return node("lemma", formula, { lemmaId });
}
function reflNode(t) {
  return node("refl", Eq(t, t));
}
function impIntro(premise, label, hypothesisFormula) {
  return node("imp_i", Imp(hypothesisFormula, premise.goal), { discharge: label, premises: [premise] });
}
function impElim(imp, antecedent) {
  need(imp.goal[0] === "imp", "imp_e \u9700\u8981\u4E00\u6761\u8574\u542B\u524D\u63D0", "error");
  need(sameFormula(imp.goal[1], antecedent.goal), "imp_e \u524D\u4EF6\u4E0E\u8574\u542B\u4E0D\u5339\u914D", "error");
  return node("imp_e", imp.goal[2], { premises: [imp, antecedent] });
}
function andIntro(left, right) {
  return node("and_i", And(left.goal, right.goal), { premises: [left, right] });
}
function andElimLeft(premise) {
  need(premise.goal[0] === "and", "and_l \u9700\u8981\u5408\u53D6\u524D\u63D0", "error");
  return node("and_l", premise.goal[1], { premises: [premise] });
}
function andElimRight(premise) {
  need(premise.goal[0] === "and", "and_r \u9700\u8981\u5408\u53D6\u524D\u63D0", "error");
  return node("and_r", premise.goal[2], { premises: [premise] });
}
function allIntro(premise, eigen) {
  need(Array.isArray(eigen) && eigen[0] === "v", "all_i \u9700\u8981\u672C\u5F81\u53D8\u91CF", "error");
  return node("all_i", All(eigen, premise.goal), { eigen, premises: [premise] });
}
function allElim(premise, term) {
  need(premise.goal[0] === "all", "all_e \u9700\u8981\u5168\u79F0\u524D\u63D0", "error");
  return node("all_e", fsub(premise.goal[2], premise.goal[1], term), { term, premises: [premise] });
}
function exIntro(formula, term, premise) {
  need(formula[0] === "ex", "ex_i \u7684\u7ED3\u8BBA\u5FC5\u987B\u662F\u5B58\u5728\u516C\u5F0F", "error");
  need(sameFormula(premise.goal, fsub(formula[2], formula[1], term)), "ex_i \u5B9E\u4F8B\u9879\u4E0E\u5B58\u5728\u516C\u5F0F\u4E0D\u5339\u914D", "error");
  return node("ex_i", formula, { term, premises: [premise] });
}
function exElim(exPremise, casePremise, label, eigen) {
  need(exPremise.goal[0] === "ex", "ex_e \u9700\u8981\u5B58\u5728\u524D\u63D0", "error");
  return node("ex_e", casePremise.goal, { eigen, discharge: label, premises: [exPremise, casePremise] });
}
function eqRewrite(eqPremise, ctxApplied, variable, context) {
  need(eqPremise.goal[0] === "eq", "eq_e \u9700\u8981\u7B49\u5F0F\u524D\u63D0", "error");
  const expected = fsub(context, variable, eqPremise.goal[2]);
  return node("eq_e", expected, { variable, context, premises: [eqPremise, ctxApplied] });
}
function kernelTheory({ id, version = "1", bases = ["o"], constants = {}, definitions = [], axioms = [] }) {
  need(typeof id === "string" && id.length > 0, "theory id required");
  const sig = { bases: [...bases], constants: { ...constants }, definitions: [] };
  const registered = /* @__PURE__ */ new Map();
  for (const d of definitions) {
    need(d.kind === void 0 || d.kind === "term", "only term definitions are supported", "unsupported");
    need(!(d.name in sig.constants), `nonfresh definition: ${d.name}`);
    const term = sourceTerm(d.term, sig);
    need(Object.keys(objectFv(term)).length === 0, "term definition must be old-language closed");
    sig.constants[d.name] = typeOk(inferTerm(term, sig), sig.bases);
    registered.set(d.name, Eq(C(d.name), lift(term, sig)));
    sig.definitions.push({ kind: "term", name: d.name, term });
  }
  const axiomList = axioms.map((a) => {
    const f = a.formula ?? axiomInstance(a.spec, sig);
    formulaOk(f, sig);
    need(Object.keys(formulaFv(f)).length === 0, "theory axioms must be closed");
    return { id: a.id, formula: f };
  });
  const theory = {
    id,
    version,
    bases: [...bases],
    constants: { ...constants },
    definitions: sig.definitions.map((d) => ({ kind: "term", name: d.name, term: d.term })),
    axioms: axiomList
  };
  return { theory, sig, definitions: registered, theoryAxioms: axiomList };
}
function checkProofGraph(proof, sig) {
  sig = ensureSig(sig);
  const problems = [];
  if (!Array.isArray(proof.steps) || proof.steps.length === 0) problems.push("\u8BC1\u660E\u6CA1\u6709\u4EFB\u4F55\u6B65\u9AA4");
  const seen = /* @__PURE__ */ new Set();
  for (const step of proof.steps ?? []) {
    if (typeof step.id !== "string" || !step.id) problems.push("\u6B65\u9AA4\u7F3A\u5C11 id");
    else if (seen.has(step.id)) problems.push(`\u6B65\u9AA4 id \u91CD\u590D\uFF1A${step.id}`);
    else seen.add(step.id);
  }
  for (const step of proof.steps ?? []) {
    for (const p of step.premises ?? []) if (!seen.has(p)) problems.push(`\u6B65\u9AA4 ${step.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6B65\u9AA4 ${p}`);
    try {
      formulaOk(step.conclusion, sig);
    } catch (error) {
      problems.push(`\u6B65\u9AA4 ${step.id} \u7684\u7ED3\u8BBA\u4E0D\u662F\u826F\u6784\u8BA4\u8BC1\u516C\u5F0F\uFF1A${error.message}`);
    }
  }
  const byId = new Map((proof.steps ?? []).map((s) => [s.id, s]));
  const state = /* @__PURE__ */ new Map();
  const visit = (id, stack) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      problems.push(`\u6B65\u9AA4\u4F9D\u8D56\u6210\u73AF\uFF1A${[...stack, id].join(" \u2192 ")}`);
      return;
    }
    state.set(id, "visiting");
    for (const p of byId.get(id)?.premises ?? []) if (byId.has(p)) visit(p, [...stack, id]);
    state.set(id, "done");
  };
  for (const id of byId.keys()) visit(id, []);
  if (typeof proof.root !== "string" || !byId.has(proof.root)) problems.push("root \u4E0D\u662F\u5DF2\u63D0\u4EA4\u7684\u6B65\u9AA4");
  if (problems.length) throw new FormalError(`\u8BC1\u660E\u56FE\u68C0\u67E5\u672A\u8FC7\uFF1A${problems.join("\uFF1B")}`, "failed");
  return true;
}
var hsOf = (step, premiseHs) => {
  switch (step.rule) {
    case "assume":
      return /* @__PURE__ */ new Set([step.hypothesis]);
    case "h_axiom":
    case "theory":
    case "definition":
    case "theorem":
      return /* @__PURE__ */ new Set();
    case "imp_i":
      return new Set([...premiseHs[0]].filter((h) => h !== step.discharge));
    case "ex_e":
      return /* @__PURE__ */ new Set([...premiseHs[0], ...[...premiseHs[1]].filter((h) => h !== step.discharge)]);
    default:
      return new Set(premiseHs.flatMap((s) => [...s]));
  }
};
function assembleProof(queryProof, ctx) {
  need(queryProof && typeof queryProof === "object", "assembleProof \u9700\u8981\u4E00\u68F5 QueryProof", "error");
  need(ctx?.sig, "assembleProof \u9700\u8981 ctx.sig", "error");
  const sig = ensureSig(ctx.sig);
  const hypotheses = ctx.hypotheses ?? /* @__PURE__ */ new Map();
  const theoryAxioms = new Map((ctx.theoryAxioms ?? []).map((a) => [a.id, a.formula]));
  const definitions = ctx.definitions ?? /* @__PURE__ */ new Map();
  const lemmas = new Map((ctx.lemmas ?? []).map((l) => [l.id, l]));
  const steps = [];
  const assigned = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const openHs = /* @__PURE__ */ new Map();
  const emit = (queryNode) => {
    if (assigned.has(queryNode)) return assigned.get(queryNode);
    need(!visiting.has(queryNode), "QueryProof \u91CC\u51FA\u73B0\u73AF\uFF08\u540C\u4E00\u8282\u70B9\u662F\u81EA\u5DF1\u7684\u7956\u5148\uFF09", "error");
    visiting.add(queryNode);
    const premises = (queryNode.premises ?? []).map(emit);
    const rule = KERNEL_RULE_OF[queryNode.rule];
    need(rule, `\u672A\u77E5\u67E5\u8BC1\u89C4\u5219\uFF1A${queryNode.rule}`, "error");
    const id = `s${steps.length}`;
    const step = { id, rule, conclusion: queryNode.goal, premises };
    switch (queryNode.rule) {
      case "hypothesis": {
        const label = queryNode.hypothesis?.id ?? queryNode.hypothesis?.name;
        need(hypotheses.has(label), `assume \u5F15\u7528\u4E86\u672A\u58F0\u660E\u7684\u5047\u8BBE\u6807\u7B7E\uFF1A${label}`);
        need(sameFormula(hypotheses.get(label), queryNode.goal), `assume \u7684\u7ED3\u8BBA\u4E0E\u5047\u8BBE ${label} \u4E0D\u4E00\u81F4`);
        step.hypothesis = label;
        break;
      }
      case "axiom": {
        const expected = axiomInstance(queryNode.instance, sig);
        need(sameFormula(expected, queryNode.goal), "h_axiom \u7684 instance \u91CD\u5EFA\u4E0D\u51FA\u8BE5\u7ED3\u8BBA");
        step.instance = queryNode.instance;
        break;
      }
      case "theory": {
        const aid = queryNode.theoryAxiomId;
        need(theoryAxioms.has(aid), `theory \u6B65\u9AA4\u5F15\u7528\u4E86\u672A\u767B\u8BB0\u7684\u6709\u9650\u7406\u8BBA\u6210\u5458\uFF1A${aid}`);
        need(sameFormula(theoryAxioms.get(aid), queryNode.goal), `theory \u6210\u5458 ${aid} \u7684\u7ED3\u8BBA\u4E0D\u4E00\u81F4`);
        step.axiom = aid;
        step.witness = digest(theoryAxioms.get(aid));
        break;
      }
      case "definition": {
        const name = queryNode.definitionName;
        need(definitions.has(name), `definition \u6B65\u9AA4\u5F15\u7528\u4E86\u672A\u767B\u8BB0\u7684\u5B9A\u4E49\uFF1A${name}`);
        need(sameFormula(definitions.get(name), queryNode.goal), `\u5B9A\u4E49 ${name} \u7684\u7B49\u5F0F\u4E0D\u4E00\u81F4`);
        step.name = name;
        break;
      }
      case "lemma": {
        const lemmaId = queryNode.lemmaId;
        need(lemmas.has(lemmaId), `theorem \u6B65\u9AA4\u5F15\u7528\u4E86\u672A\u77E5\u5F15\u7406\uFF1A${lemmaId}`);
        const lemma = lemmas.get(lemmaId);
        need(sameFormula(lemma.conclusion, queryNode.goal), `\u5F15\u7406 ${lemmaId} \u7684\u7ED3\u8BBA\u4E0D\u4E00\u81F4`);
        need(ctx.theorySha256, "theorem \u6B65\u9AA4\u9700\u8981 ctx.theorySha256");
        const proofSha = ctx.proofDigests?.get(lemma.proofId);
        need(proofSha, `theorem \u6B65\u9AA4\u7F3A\u5C11\u5F15\u7406 ${lemma.proofId} \u7684\u8BC1\u660E\u6458\u8981`);
        step.reference = { id: lemma.proofId, checker: KERNEL_VERSION, theory_sha256: ctx.theorySha256, proof_sha256: proofSha };
        break;
      }
      case "imp_i": {
        need(hypotheses.has(queryNode.discharge), `imp_i \u91CA\u653E\u4E86\u672A\u58F0\u660E\u7684\u5047\u8BBE\uFF1A${queryNode.discharge}`);
        need(sameFormula(queryNode.goal, Imp(hypotheses.get(queryNode.discharge), queryNode.premises[0].goal)), "imp_i \u7684\u7ED3\u8BBA\u4E0E\u91CA\u653E\u7684\u5047\u8BBE\u4E0D\u5339\u914D");
        step.discharge = queryNode.discharge;
        break;
      }
      case "imp_e": {
        const [imp, ante] = queryNode.premises;
        need(imp.goal[0] === "imp" && sameFormula(imp.goal[1], ante.goal) && sameFormula(queryNode.goal, imp.goal[2]), "imp_e \u5F62\u72B6\u4E0D\u5339\u914D");
        break;
      }
      case "and_i":
        need(sameFormula(queryNode.goal, And(queryNode.premises[0].goal, queryNode.premises[1].goal)), "and_i \u5F62\u72B6\u4E0D\u5339\u914D");
        break;
      case "and_l":
        need(queryNode.premises[0].goal[0] === "and" && sameFormula(queryNode.goal, queryNode.premises[0].goal[1]), "and_l \u5F62\u72B6\u4E0D\u5339\u914D");
        break;
      case "and_r":
        need(queryNode.premises[0].goal[0] === "and" && sameFormula(queryNode.goal, queryNode.premises[0].goal[2]), "and_r \u5F62\u72B6\u4E0D\u5339\u914D");
        break;
      case "refl":
        need(queryNode.goal[0] === "eq" && deepEqual(queryNode.goal[1], queryNode.goal[2]), "refl \u53EA\u80FD\u662F t = t");
        break;
      case "eq_e": {
        const [eqPremise, ctxApplied] = queryNode.premises;
        need(eqPremise.goal[0] === "eq", "eq_e \u7684\u7B2C\u4E00\u524D\u63D0\u5FC5\u987B\u662F\u7B49\u5F0F");
        need(sameFormula(ctxApplied.goal, fsub(queryNode.context, queryNode.variable, eqPremise.goal[1])), "eq_e \u7684 ctx[l/v] \u4E0E\u7B2C\u4E8C\u524D\u63D0\u4E0D\u4E00\u81F4");
        need(sameFormula(queryNode.goal, fsub(queryNode.context, queryNode.variable, eqPremise.goal[2])), "eq_e \u7684 ctx[r/v] \u4E0E\u7ED3\u8BBA\u4E0D\u4E00\u81F4");
        step.variable = queryNode.variable;
        step.context = queryNode.context;
        break;
      }
      case "all_i": {
        need(queryNode.goal[0] === "all", "all_i \u7684\u7ED3\u8BBA\u5FC5\u987B\u662F\u5168\u79F0\u516C\u5F0F");
        need(sameFormula(queryNode.premises[0].goal, fsub(queryNode.goal[2], queryNode.goal[1], queryNode.eigen)), "all_i \u7684\u5B9E\u4F8B\u4E0E\u672C\u5F81\u53D8\u91CF\u4E0D\u5339\u914D");
        step.variable = queryNode.eigen;
        break;
      }
      case "all_e": {
        const premise = queryNode.premises[0];
        need(premise.goal[0] === "all", "all_e \u7684\u524D\u63D0\u5FC5\u987B\u662F\u5168\u79F0\u516C\u5F0F");
        need(sameFormula(queryNode.goal, fsub(premise.goal[2], premise.goal[1], queryNode.term)), "all_e \u7684\u5B9E\u4F8B\u9879\u4E0D\u5339\u914D");
        step.term = queryNode.term;
        break;
      }
      case "ex_i": {
        need(queryNode.goal[0] === "ex", "ex_i \u7684\u7ED3\u8BBA\u5FC5\u987B\u662F\u5B58\u5728\u516C\u5F0F");
        need(sameFormula(queryNode.premises[0].goal, fsub(queryNode.goal[2], queryNode.goal[1], queryNode.term)), "ex_i \u7684\u5B9E\u4F8B\u9879\u4E0D\u5339\u914D");
        step.term = queryNode.term;
        break;
      }
      case "ex_e": {
        const [exPremise, casePremise] = queryNode.premises;
        need(exPremise.goal[0] === "ex", "ex_e \u7684\u7B2C\u4E00\u524D\u63D0\u5FC5\u987B\u662F\u5B58\u5728\u516C\u5F0F");
        const label = queryNode.discharge;
        need(hypotheses.has(label), `ex_e \u91CA\u653E\u4E86\u672A\u58F0\u660E\u7684\u5047\u8BBE\uFF1A${label}`);
        need(sameFormula(hypotheses.get(label), fsub(exPremise.goal[2], exPremise.goal[1], queryNode.eigen)), "ex_e \u7684 case \u5047\u8BBE\u4E0E\u672C\u5F81\u5B9E\u4F8B\u4E0D\u4E00\u81F4");
        need(sameFormula(queryNode.goal, casePremise.goal), "ex_e \u7684\u7ED3\u8BBA\u5FC5\u987B\u7B49\u4E8E case \u63A8\u5BFC\u7684\u7ED3\u8BBA");
        step.variable = queryNode.eigen;
        step.discharge = label;
        break;
      }
      default:
        throw new FormalError(`\u672A\u5B9E\u73B0\u7684\u89C4\u5219\uFF1A${queryNode.rule}`, "error");
    }
    formulaOk(step.conclusion, sig);
    const premiseHs = premises.map((pid) => openHs.get(pid) ?? /* @__PURE__ */ new Set());
    openHs.set(id, hsOf(step, premiseHs));
    steps.push(step);
    visiting.delete(queryNode);
    assigned.set(queryNode, id);
    return id;
  };
  const root = emit(queryProof);
  if (steps.length > MAX_STEPS) throw new FormalError(`\u8BC1\u4E66\u6B65\u6570\u8D85\u8FC7\u5185\u6838\u4E0A\u9650 ${MAX_STEPS}`, "resource_exhausted");
  const conclusion = ctx.rootConclusion ? ctx.rootConclusion : queryProof.goal;
  need(sameFormula(conclusion, queryProof.goal), "rootConclusion \u4E0E\u6839\u8282\u70B9\u7ED3\u8BBA\u4E0D\u4E00\u81F4");
  const open = openHs.get(root) ?? /* @__PURE__ */ new Set();
  const openHypotheses = {};
  for (const label of [...open].sort()) openHypotheses[label] = hypotheses.get(label);
  const usedLabels = /* @__PURE__ */ new Set();
  for (const step of steps) {
    if (step.hypothesis) usedLabels.add(step.hypothesis);
    if (step.discharge) usedLabels.add(step.discharge);
  }
  const declared = {};
  for (const label of [...usedLabels].sort()) {
    need(hypotheses.has(label), `\u6B65\u9AA4\u5F15\u7528\u4E86\u672A\u58F0\u660E\u7684\u5047\u8BBE\u6807\u7B7E\uFF1A${label}`);
    declared[label] = hypotheses.get(label);
  }
  const proof = { steps, hypotheses: declared, root, conclusion, open_hypotheses: openHypotheses };
  checkProofGraph(proof, sig);
  if (ctx.objectConclusion !== void 0 && ctx.objectConclusion !== null) proof.object_conclusion = ctx.objectConclusion;
  return proof;
}
function assembleBundle({ theory, proof, targetId = "main" }) {
  need(theory && typeof theory === "object", "assembleBundle \u9700\u8981 theory", "error");
  need(proof && typeof proof === "object", "assembleBundle \u9700\u8981 proof", "error");
  const theorySha = digest(theory);
  const filled = { checker: KERNEL_VERSION, theory_sha256: theorySha, ...proof };
  need(Array.isArray(filled.steps) && filled.steps.length > 0, "proof.steps \u4E0D\u80FD\u4E3A\u7A7A", "error");
  need(typeof filled.root === "string", "proof.root \u5FC5\u987B\u662F\u6B65\u9AA4 id", "error");
  need(filled.conclusion !== void 0, "proof.conclusion \u5FC5\u586B", "error");
  need(filled.open_hypotheses !== void 0, "proof.open_hypotheses \u5FC5\u586B", "error");
  filled.hypotheses = filled.hypotheses ?? {};
  return { format: KERNEL_VERSION, theory, proofs: { [targetId]: filled }, target: targetId };
}

// ../mcs-web/core/formal/search.mjs
var import_node_module = require("node:module");

// ../mcs-web/core/formal/unify.mjs
var metaCounter = 0;
function freshMeta(prefix = "m", type = "o") {
  metaCounter += 1;
  return ["?", `${prefix}#${metaCounter}`, type];
}
function isMeta(t) {
  return Array.isArray(t) && t.length === 3 && t[0] === "?";
}
var metaId = (t) => t[1];
function deref(t, env) {
  let current = t;
  const seen = /* @__PURE__ */ new Set();
  while (isMeta(current) && env && env.has(metaId(current))) {
    if (seen.has(metaId(current))) break;
    seen.add(metaId(current));
    current = env.get(metaId(current));
  }
  return current;
}
function isGround(t, env = null) {
  const node2 = env ? deref(t, env) : t;
  if (isMeta(node2)) return false;
  if (!Array.isArray(node2)) return true;
  return node2.every((a) => Array.isArray(a) ? isGround(a, env) : true);
}
function applyEnv(t, env) {
  const node2 = deref(t, env);
  if (isMeta(node2)) return node2;
  if (!Array.isArray(node2)) return node2;
  if (node2[0] === "lift") return ["lift", node2[1], node2[2].map((a) => applyEnv(a, env))];
  return node2.map((a) => Array.isArray(a) ? applyEnv(a, env) : a);
}
function whnf(t, sig, env = /* @__PURE__ */ new Map(), fuel = 128) {
  let node2 = deref(t, env);
  if (fuel <= 0 || !Array.isArray(node2)) return node2;
  if (node2[0] === "c") {
    const entry = definitionFor(sig, node2[1]);
    if (!entry) return node2;
    return whnf(lift(entry.term, sig), sig, env, fuel - 1);
  }
  if (node2[0] === "app") {
    if (node2.length !== 3) throw new FormalError("application arity", "error");
    const f = whnf(node2[1], sig, env, fuel - 1);
    if (Array.isArray(f) && f[0] === "lam") return whnf(openBody(f[2], node2[2]), sig, env, fuel - 1);
    if (Array.isArray(f) && f[0] === "c") {
      const entry = definitionFor(sig, f[1]);
      if (entry) {
        const lifted = lift(entry.term, sig);
        if (Array.isArray(lifted) && lifted[0] === "lift") {
          return ["app", lifted, node2[2]];
        }
        return whnf(["app", lifted, node2[2]], sig, env, fuel - 1);
      }
    }
    return ["app", f, node2[2]];
  }
  return node2;
}
function definitionFor(sig, name) {
  const list = sig?.definitions ?? [];
  return list.find((d) => d.name === name && (d.kind ?? "term") === "term") ?? null;
}
function bind(env, trail, meta, value) {
  env.set(metaId(meta), value);
  trail.push(metaId(meta));
}
function occurs(id, t, env) {
  const node2 = deref(t, env);
  if (isMeta(node2)) return metaId(node2) === id;
  if (!Array.isArray(node2)) return false;
  if (node2[0] === "lift") return node2[2].some((a) => occurs(id, a, env));
  return node2.some((a) => Array.isArray(a) ? occurs(id, a, env) : false);
}
function unifyTerms(a0, b0, env, sig, trail, depth) {
  if (depth > 512) throw new FormalError("unification depth bound exceeded", "resource_exhausted");
  const a = whnf(a0, sig, env);
  const b = whnf(b0, sig, env);
  if (isMeta(a)) {
    if (isMeta(b) && metaId(a) === metaId(b)) return true;
    if (occurs(metaId(a), b, env)) return false;
    bind(env, trail, a, b);
    return true;
  }
  if (isMeta(b)) {
    if (occurs(metaId(b), a, env)) return false;
    bind(env, trail, b, a);
    return true;
  }
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  if (a[0] !== b[0]) return false;
  switch (a[0]) {
    case "v":
      return a[1] === b[1] && unifyTerms(a[2], b[2], env, sig, trail, depth + 1);
    case "b":
      return a[1] === b[1] && unifyTerms(a[2], b[2], env, sig, trail, depth + 1);
    case "c":
    case "logic":
      return deepEqual(a, b);
    case "lam":
      return unifyTerms(a[1], b[1], env, sig, trail, depth + 1) && unifyTerms(a[2], b[2], env, sig, trail, depth + 1);
    case "app":
      return unifyTerms(a[1], b[1], env, sig, trail, depth + 1) && unifyTerms(a[2], b[2], env, sig, trail, depth + 1);
    case "lift":
      if (!deepEqual(a[1], b[1])) return false;
      return a[2].every((x, i) => unifyTerms(x, b[2][i], env, sig, trail, depth + 1));
    case "all":
    case "ex": {
      if (!unifyTerms(a[1][2], b[1][2], env, sig, trail, depth + 1)) return false;
      const x = V(a[1][1], a[1][2]);
      const left = substBinder(a, x);
      const right = substBinder(b, x);
      return unifyTerms(left, right, env, sig, trail, depth + 1);
    }
    case "eq":
    case "imp":
    case "and":
    case "or":
      return a.every((x, i) => Array.isArray(x) ? unifyTerms(x, b[i], env, sig, trail, depth + 1) : x === b[i]);
    case "false":
      return true;
    default:
      return deepEqual(a, b);
  }
}
function substBinder(f, v) {
  const binder = f[1];
  const body = f[2];
  if (binder[1] === v[1]) return body;
  const swapped = swapVar(body, binder, v);
  return swapped;
}
function swapVar(node2, from, to) {
  if (deepEqual(node2, from)) return to;
  if (!Array.isArray(node2)) return node2;
  if (node2[0] === "c" || node2[0] === "b" || node2[0] === "v" && node2[1] !== from[1]) return node2;
  if (node2[0] === "lift") return ["lift", node2[1], node2[2].map((a) => swapVar(a, from, to))];
  return node2.map((a) => Array.isArray(a) ? swapVar(a, from, to) : a);
}
function unify(a, b, env = /* @__PURE__ */ new Map(), sig = { bases: ["o"], constants: {} }) {
  const trail = [];
  let ok = false;
  try {
    ok = unifyTerms(a, b, env, sig, trail, 0);
  } catch (error) {
    if (error instanceof FormalError && (error.status === "resource_exhausted" || error.status === "timeout")) throw error;
    if (!(error instanceof FormalError)) throw error;
    ok = false;
  }
  if (!ok) for (const id of trail) env.delete(id);
  return ok;
}

// ../mcs-web/core/formal/clauses.mjs
var HOLDS_PRED = ["logic", "holds"];
var EQ_PRED = ["logic", "eq"];
function isHoldsAtom(atom) {
  return Array.isArray(atom?.pred) && deepEqual(atom.pred, HOLDS_PRED);
}
function isEqAtom(atom) {
  return Array.isArray(atom?.pred) && deepEqual(atom.pred, EQ_PRED);
}
function holdsAtom(t) {
  return { kind: "pred", pred: HOLDS_PRED, args: [t] };
}
function eqAtom(l, r) {
  return { kind: "pred", pred: EQ_PRED, args: [l, r] };
}
function atomToFormula(atom) {
  need(atom?.kind === "pred" && Array.isArray(atom.args), "invalid clause atom");
  let out;
  if (isHoldsAtom(atom)) {
    need(atom.args.length === 1, "holds arity");
    out = B2(atom.args[0]);
  } else if (isEqAtom(atom)) {
    need(atom.args.length === 2, "eq arity");
    out = ["eq", atom.args[0], atom.args[1]];
  } else {
    throw new FormalError("unknown clause predicate", "unsupported");
  }
  const quant = atom.quant ?? [];
  for (let i = quant.length - 1; i >= 0; i -= 1) out = underBinder(quant[i], out);
  return out;
}
function withQuant(atom, binder) {
  return { ...atom, quant: [binder, ...atom.quant ?? []] };
}
function underBinder(binder, body) {
  need(binder && typeof binder === "object", "invalid clause atom binder");
  if (binder.role === "eigen") {
    need(Array.isArray(binder.var) && binder.var[0] === "v", "eigen \u91CF\u8BCD\u524D\u7F00\u9700\u8981\u672C\u5F81\u53D8\u91CF");
    return All(binder.var, body);
  }
  if (binder.role === "meta") {
    const meta = binder.meta;
    need(isMeta(meta), "meta \u91CF\u8BCD\u524D\u7F00\u9700\u8981\u5143\u53D8\u91CF");
    const forbidden = new Set(allNames(body));
    const name = typeof binder.name === "string" && binder.name && !forbidden.has(binder.name) ? binder.name : fresh(forbidden);
    const v = V(name, meta[2]);
    return Ex(v, replaceMeta(body, meta, v));
  }
  throw new FormalError(`\u672A\u77E5\u7684\u91CF\u8BCD\u524D\u7F00\u89D2\u8272\uFF1A${binder.role}`, "unsupported");
}
function metaBinderName(meta) {
  return `w${String(meta[1] ?? "x").replace(/[^0-9A-Za-z]+/g, "_")}`;
}
function replaceMetaTerm(t, meta, v) {
  if (deepEqual(t, meta)) return v;
  if (!Array.isArray(t)) return t;
  if (t[0] === "app") return App(replaceMetaTerm(t[1], meta, v), replaceMetaTerm(t[2], meta, v));
  if (t[0] === "lift") return ["lift", t[1], t[2].map((a) => replaceMetaTerm(a, meta, v))];
  return t;
}
function replaceMeta(f, meta, v) {
  if (!Array.isArray(f) || f.length === 0) return f;
  if (f[0] === "eq") return Eq(replaceMetaTerm(f[1], meta, v), replaceMetaTerm(f[2], meta, v));
  if (f[0] === "and" || f[0] === "or" || f[0] === "imp") {
    return [f[0], replaceMeta(f[1], meta, v), replaceMeta(f[2], meta, v)];
  }
  if (f[0] === "all" || f[0] === "ex") return [f[0], f[1], replaceMeta(f[2], meta, v)];
  return f;
}
function clauseCtx(sig, prefix) {
  return { sig: normalizeSig(sig), prefix, seq: 0, eigenSeq: 0 };
}
function nextClauseId(ctx) {
  ctx.seq += 1;
  return `${ctx.prefix}${ctx.seq}`;
}
function eigenVariable(ctx, type, used) {
  let i = ctx.eigenSeq;
  for (; ; ) {
    const name = `e${i}`;
    i += 1;
    if (name in ctx.sig.constants) continue;
    if (used.has(name)) continue;
    ctx.eigenSeq = i;
    return V(name, type);
  }
}
function factClauses(f, sig, { prefix = "c", ctx = null } = {}) {
  const c = ctx ?? clauseCtx(sig, prefix);
  return factOf(f, c);
}
function factOf(f, ctx) {
  const k = f[0];
  if (k === "false") throw new FormalError("fact \u4FA7\u4E0D\u63A5\u53D7 false\uFF08\u5185\u6838\u6CA1\u6709 false_e\uFF09", "unsupported");
  if (k === "or") throw new FormalError("\u8BA4\u8BC1\u8BED\u8A00\u4E0D\u63A5\u53D7\u6790\u53D6\uFF08\u5185\u6838\u6CA1\u6709 or \u89C4\u5219\uFF09", "unsupported");
  if (k === "eq") {
    const atom = deepEqual(f[2], L2("true")) ? holdsAtom(f[1]) : eqAtom(f[1], f[2]);
    return [{ id: nextClauseId(ctx), head: atom, body: [], vars: [], source: { kind: "formula", formula: f } }];
  }
  if (k === "and") return [...factOf(f[1], ctx), ...factOf(f[2], ctx)];
  if (k === "imp") {
    const body = goalOf(f[1], ctx, "body");
    return factOf(f[2], ctx).map((clause) => ({ ...clause, body: [...body, ...clause.body], source: { kind: "implication", formula: f, antecedent: f[1] } }));
  }
  if (k === "all") {
    const meta = freshMeta("x", f[1][2]);
    const bodyClauses = factOf(fsub(f[2], f[1], meta), ctx);
    return bodyClauses.map((clause) => ({ ...clause, vars: [meta, ...clause.vars], source: { kind: "all", formula: f, binder: f[1] } }));
  }
  if (k === "ex") {
    const used = /* @__PURE__ */ new Set([...allNames(f), ...Object.keys(ctx.sig.constants)]);
    const eigen = eigenVariable(ctx, f[1][2], used);
    const bodyClauses = factOf(fsub(f[2], f[1], eigen), ctx);
    return bodyClauses.map((clause) => ({ ...clause, vars: [eigen, ...clause.vars], source: { kind: "ex", formula: f, binder: f[1], eigen } }));
  }
  throw new FormalError(`\u4E0D\u652F\u6301\u628A\u516C\u5F0F\u7FFB\u8BD1\u6210\u5B50\u53E5\uFF1A${k}`, "unsupported");
}
function goalOf(f, ctx, mode = "goal") {
  const k = f[0];
  if (k === "false") throw new FormalError("false \u5728\u9996\u7248\u4E0D\u53EF\u8BC1\uFF08\u6CA1\u6709 false_e \u89C4\u5219\uFF09", "unsupported");
  if (k === "or") throw new FormalError("\u8BA4\u8BC1\u8BED\u8A00\u4E0D\u63A5\u53D7\u6790\u53D6\uFF08\u5185\u6838\u6CA1\u6709 or \u89C4\u5219\uFF09", "unsupported");
  if (k === "eq") return [deepEqual(f[2], L2("true")) ? holdsAtom(f[1]) : eqAtom(f[1], f[2])];
  if (k === "and") return [...goalOf(f[1], ctx, mode), ...goalOf(f[2], ctx, mode)];
  if (k === "imp") {
    if (mode === "body") {
      throw new FormalError(
        "\u5F85\u8BC1\u5B50\u76EE\u6807\u7684\u524D\u4EF6\u91CC\u51FA\u73B0\u8574\u542B\uFF08(a \u21D2 b) \u21D2 c\uFF09\uFF1A\u5B50\u53E5\u4F53\u91CC\u6CA1\u6709\u627F\u8F7D\u5047\u8BBE a \u7684\u4F4D\u7F6E\uFF0C\u4E22\u6389\u5B83\u5C31\u7B49\u4E8E\u7ED9\u516C\u7406\u5C11\u5199\u4E00\u4E2A\u524D\u63D0\u2014\u2014\u8D85\u51FA\u5B9A\u5B50\u53E5\u7247\u6BB5",
        "unsupported"
      );
    }
    return goalOf(f[2], ctx, mode);
  }
  if (k === "all") {
    const used = /* @__PURE__ */ new Set([...allNames(f), ...Object.keys(ctx.sig.constants)]);
    const eigen = eigenVariable(ctx, f[1][2], used);
    return goalOf(fsub(f[2], f[1], eigen), ctx, mode).map((atom) => withQuant(atom, { role: "eigen", var: eigen }));
  }
  if (k === "ex") {
    const meta = freshMeta("x", f[1][2]);
    const inner = goalOf(fsub(f[2], f[1], meta), ctx, mode);
    if (mode === "body" && inner.length !== 1) {
      throw new FormalError(
        "\u5F85\u8BC1\u5B50\u76EE\u6807\u7684\u524D\u4EF6\u91CC\uFF0C\u5B58\u5728\u91CF\u8BCD\u4F53\u662F\u4E00\u4E2A\u5408\u53D6\uFF08\u2203x.(P\u2227Q)\uFF09\uFF1A\u62C6\u6210\u591A\u4E2A\u539F\u5B50\u7B49\u4E8E\u628A \u2203 \u5206\u914D\u5230 \u2227 \u4E0A\uFF0C(\u2203x.P) \u2227 (\u2203x.Q) \u6BD4 \u2203x.(P\u2227Q) \u5F31\u2014\u2014\u524D\u63D0\u88AB\u5F31\u5316\uFF0C\u8D85\u51FA\u5B9A\u5B50\u53E5\u7247\u6BB5",
        "unsupported"
      );
    }
    const binder = { role: "meta", meta, name: metaBinderName(meta) };
    return inner.map((atom) => withQuant(atom, binder));
  }
  throw new FormalError(`\u4E0D\u652F\u6301\u628A\u516C\u5F0F\u7FFB\u8BD1\u6210\u76EE\u6807\u539F\u5B50\uFF1A${k}`, "unsupported");
}
function goalTaskTree(f, sig, { prefix = "c" } = {}) {
  const ctx = clauseCtx(sig, prefix);
  return goalTask(f, [], ctx);
}
function goalTask(f, clauses, ctx) {
  const k = f[0];
  if (k === "and") {
    return {
      formula: f,
      kind: "and",
      clauses: [],
      goals: [],
      parts: [goalTask(f[1], clauses, ctx), goalTask(f[2], clauses, ctx)]
    };
  }
  if (k === "imp") {
    const ante = factOf(f[1], ctx);
    const inner = goalTask(f[2], [...clauses, ...ante], ctx);
    return { formula: f, kind: "imp", clauses: [], goals: [], hypothesis: f[1], antecedentClauses: ante, parts: [inner] };
  }
  if (k === "all") {
    const used = /* @__PURE__ */ new Set([...allNames(f), ...Object.keys(ctx.sig.constants)]);
    const eigen = eigenVariable(ctx, f[1][2], used);
    const inner = goalTask(fsub(f[2], f[1], eigen), clauses, ctx);
    return { formula: f, kind: "all", clauses: [], goals: [], eigen, parts: [inner] };
  }
  if (k === "ex") {
    const meta = freshMeta("x", f[1][2]);
    const inner = goalTask(fsub(f[2], f[1], meta), clauses, ctx);
    return { formula: f, kind: "ex", clauses: [], goals: [], meta, parts: [inner] };
  }
  if (k === "false") throw new FormalError("false \u5728\u9996\u7248\u4E0D\u53EF\u8BC1\uFF08\u6CA1\u6709 false_e \u89C4\u5219\uFF09", "unsupported");
  if (k === "or") throw new FormalError("\u8BA4\u8BC1\u8BED\u8A00\u4E0D\u63A5\u53D7\u6790\u53D6\uFF08\u5185\u6838\u6CA1\u6709 or \u89C4\u5219\uFF09", "unsupported");
  if (k === "eq") {
    const atom = deepEqual(f[2], L2("true")) ? holdsAtom(f[1]) : eqAtom(f[1], f[2]);
    return { formula: f, kind: "leaf", clauses, goals: [atom], parts: null };
  }
  throw new FormalError(`\u4E0D\u652F\u6301\u7684\u76EE\u6807\u516C\u5F0F\uFF1A${k}`, "unsupported");
}
function leafTasks(task, out = []) {
  if (!task) return out;
  if (task.kind === "leaf") {
    out.push(task);
    return out;
  }
  for (const part of task.parts ?? []) leafTasks(part, out);
  return out;
}
function clausifyFormula(f, sig, { role = "goal", prefix = "c" } = {}) {
  sig = normalizeSig(sig);
  formulaOk(f, sig);
  if (role === "fact") {
    const clauses = factClauses(f, sig, { prefix });
    return { clauses, goals: [], tasks: [{ formula: f, kind: "leaf", clauses, goals: [] }], taskTree: null, unsupported: null };
  }
  if (role !== "goal") throw new FormalError(`unknown clausify role: ${role}`, "error");
  const taskTree = goalTaskTree(f, sig, { prefix });
  const tasks = leafTasks(taskTree);
  const single = tasks.length === 1 && deepEqual(tasks[0].formula, f);
  return {
    clauses: single ? tasks[0].clauses : [],
    goals: single ? tasks[0].goals : [],
    tasks,
    taskTree,
    unsupported: null
  };
}
function clauseToFormula(clause) {
  const parts = [clause.head, ...clause.body ?? []];
  const metas = orderedMetas(parts, clause.vars);
  const forbidden = /* @__PURE__ */ new Set();
  for (const part of parts) for (const name of allNames(part.args ?? [])) forbidden.add(name);
  const names = /* @__PURE__ */ new Map();
  for (const meta of metas) {
    const name = fresh(forbidden);
    forbidden.add(name);
    names.set(meta[1], V(name, meta[2]));
  }
  const used = /* @__PURE__ */ new Set();
  const put = (f) => replaceClauseMetas(f, names, used);
  let out = put(atomToFormula(clause.head));
  for (let i = (clause.body ?? []).length - 1; i >= 0; i -= 1) out = Imp(put(atomToFormula(clause.body[i])), out);
  for (let i = metas.length - 1; i >= 0; i -= 1) {
    if (used.has(metas[i][1])) out = All(names.get(metas[i][1]), out);
  }
  return out;
}
function orderedMetas(parts, vars) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (meta) => {
    if (!isMeta(meta) || seen.has(meta[1])) return;
    seen.add(meta[1]);
    out.push(meta);
  };
  for (const variable of vars ?? []) add(variable);
  const walk = (node2) => {
    if (Array.isArray(node2) && isMeta(node2)) {
      add(node2);
      return;
    }
    if (!Array.isArray(node2)) return;
    for (const item of node2) walk(item);
  };
  for (const part of parts) walk(part?.args ?? part);
  return out;
}
function replaceClauseMetas(f, names, used) {
  const term = (t) => {
    if (!Array.isArray(t)) return t;
    if (isMeta(t) && names.has(t[1])) {
      used.add(t[1]);
      return names.get(t[1]);
    }
    if (t[0] === "app") return App(term(t[1]), term(t[2]));
    if (t[0] === "lift") return ["lift", t[1], t[2].map(term)];
    return t;
  };
  if (!Array.isArray(f) || f.length === 0) return f;
  if (f[0] === "eq") return Eq(term(f[1]), term(f[2]));
  if (f[0] === "and" || f[0] === "or" || f[0] === "imp") {
    return [f[0], replaceClauseMetas(f[1], names, used), replaceClauseMetas(f[2], names, used)];
  }
  if (f[0] === "all" || f[0] === "ex") return [f[0], f[1], replaceClauseMetas(f[2], names, used)];
  return f;
}

// ../mcs-web/core/formal/search.mjs
var require2 = (0, import_node_module.createRequire)(__filename);
var languageModule;
function languageLayer(options) {
  if (options?.language) return options.language;
  if (languageModule === void 0) {
    try {
      languageModule = require2("./language.mjs");
    } catch {
      languageModule = null;
    }
  }
  return languageModule;
}
function normalizeVariables(raw, language) {
  const out = {};
  if (raw === void 0 || raw === null) return out;
  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  for (const [name, type] of entries) {
    need(typeof name === "string" && name.length > 0, "options.variables \u7684\u540D\u5B57\u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32", "error");
    if (typeof type === "string") {
      need(
        language && typeof language.parseType === "function",
        "options.variables \u7684\u7C7B\u578B\u662F\u6E90\u7801\u5B57\u7B26\u4E32\uFF0C\u9700\u8981 core/formal/language.mjs \u7684 parseType\uFF08\u6216 options.language\uFF09",
        "error"
      );
      try {
        out[name] = language.parseType(type);
      } catch (error) {
        throw new FormalError(`options.variables[${name}] \u7684\u7C7B\u578B\u6E90\u7801\u89E3\u6790\u5931\u8D25\uFF1A${error?.message ?? error}`, "error");
      }
    } else {
      need(Array.isArray(type), `options.variables[${name}] \u7684\u7C7B\u578B\u5FC5\u987B\u662F\u7C7B\u578B\u8282\u70B9\u6216\u6E90\u7801\u5B57\u7B26\u4E32`, "error");
      out[name] = type;
    }
  }
  return out;
}
function freeUpTerm(node2, names) {
  if (!Array.isArray(node2)) return node2;
  switch (node2[0]) {
    case "c":
      return names.has(node2[1]) ? V(node2[1], names.get(node2[1])) : node2;
    case "app":
      return App(freeUpTerm(node2[1], names), freeUpTerm(node2[2], names));
    case "lam":
      return ["lam", node2[1], freeUpTerm(node2[2], names)];
    // lift 的抽象体里可以有自由变量（group 证书的 `lift(λx. mul g x, [g])` 就是这样），参数表也要换。
    case "lift":
      return ["lift", freeUpTerm(node2[1], names), node2[2].map((arg) => freeUpTerm(arg, names))];
    default:
      return node2;
  }
}
function freeUpFormula(node2, names) {
  if (!Array.isArray(node2) || node2.length === 0) return node2;
  switch (node2[0]) {
    case "eq":
      return Eq(freeUpTerm(node2[1], names), freeUpTerm(node2[2], names));
    case "and":
    case "or":
    case "imp":
      return [node2[0], freeUpFormula(node2[1], names), freeUpFormula(node2[2], names)];
    case "all":
    case "ex":
      return [node2[0], node2[1], freeUpFormula(node2[2], names)];
    // 绑定名不动
    default:
      return node2;
  }
}
function parseSourceFormula(source, options, sig) {
  const language = languageLayer(options);
  need(
    language && typeof language.parseFormula === "function",
    "\u5B57\u7B26\u4E32\u76EE\u6807\u9700\u8981 core/formal/language.mjs \u7684 parseFormula\uFF08\u6216 options.language\uFF09",
    "error"
  );
  const variables = normalizeVariables(options.variables, language);
  for (const name of Object.keys(variables)) {
    need(!(name in (sig?.constants ?? {})), `\u81EA\u7531\u53D8\u91CF ${name} \u4E0E\u7406\u8BBA\u5E38\u91CF\u540C\u540D\uFF1A\u540C\u540D\u4E0D\u540C\u7269\uFF0C\u62D2\u7EDD\u89E3\u6790`, "error");
  }
  const names = new Map(Object.entries(variables));
  const ctx = {
    bases: sig?.bases ?? ["o"],
    constants: { ...variables, ...sig?.constants ?? {} },
    definitions: sig?.definitions ?? [],
    variables,
    strict: options.strict,
    backgrounds: options.backgrounds,
    background: options.background
  };
  let formula;
  try {
    formula = language.parseFormula(source, ctx);
  } catch (error) {
    const details = error?.details ?? {};
    const where = details.line === void 0 || details.line === null ? "" : `\uFF08\u7B2C ${details.line} \u884C\u7B2C ${details.column ?? "?"} \u5217${details.token === void 0 || details.token === null ? "" : `\uFF0C\u8BB0\u53F7 ${JSON.stringify(details.token)}`}\uFF09`;
    const status = details.reason === "unsupported" ? "unsupported" : "error";
    throw new FormalError(`\u76EE\u6807\u6E90\u7801\u89E3\u6790\u5931\u8D25${where}\uFF1A${error?.message ?? error}`, status);
  }
  const formula2 = names.size ? freeUpFormula(formula, names) : formula;
  formulaOk(formula2, sig);
  return formula2;
}
function resolveProgram(program, options, sig) {
  if (!program || typeof program !== "object") return { hypotheses: [], clauses: [] };
  const parseIfSource = (value) => typeof value === "string" ? parseSourceFormula(value, options, sig) : value;
  const hypotheses = (program.hypotheses ?? []).map((hyp) => hyp && typeof hyp.formula === "string" ? { ...hyp, formula: parseIfSource(hyp.formula) } : hyp);
  const clauses = (program.clauses ?? []).map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const out = { ...entry };
    if (typeof out.formula === "string") out.formula = parseIfSource(out.formula);
    if (typeof out.conclusion === "string") out.conclusion = parseIfSource(out.conclusion);
    return out;
  });
  return { ...program, hypotheses, clauses };
}
var BRIDGE_OPS = ["and", "imp"];
var DEFAULT_OPTIONS = { maxDepth: 8, maxStates: 1e4, maxMs: 2e3, maxSteps: MAX_STEPS, trace: false };
var TRUTH = L2("true");
var isTruthEq = (f) => Array.isArray(f) && f[0] === "eq" && deepEqual(f[2], TRUTH);
function trace(state, message) {
  if (!state.trace) return;
  state.traceLines.push(message);
  console.error(`[search] ${message}`);
}
function budget(state, kind) {
  throw new FormalError(`\u641C\u7D22\u9884\u7B97\u8017\u5C3D\uFF08${kind}\uFF09`, "timeout");
}
var Scope = class {
  constructor(parent, sig) {
    this.parent = parent;
    this.sig = sig;
    this.map = /* @__PURE__ */ new Map();
    this.pending = parent ? [...parent.pending] : [];
    this.queued = parent ? new Set(parent.queued) : /* @__PURE__ */ new Set();
    this.saturated = false;
    this.pushed = 0;
    this.capped = false;
    this.terms = parent ? [...parent.terms] : [];
    this.termKeys = parent ? new Set(parent.termKeys) : /* @__PURE__ */ new Set();
  }
  lookup(key) {
    for (let s = this; s; s = s.parent) if (s.map.has(key)) return s.map.get(key);
    return null;
  }
  entries() {
    const out = [];
    for (let s = this; s; s = s.parent) for (const e of s.map.entries()) out.push(e);
    return out;
  }
  nodeEntries() {
    const out = [];
    for (let s = this; s; s = s.parent) for (const node2 of s.map.values()) out.push(node2);
    return out;
  }
};
function addTerm(state, scope, term) {
  let key;
  try {
    key = formulaKey(term);
  } catch {
    return;
  }
  if (scope.termKeys.has(key) || scope.terms.length >= 400) return;
  scope.termKeys.add(key);
  scope.terms.push(term);
  state.states += 1;
}
function addTermsOf(state, scope, node2) {
  for (const t of subterms(node2)) addTerm(state, scope, t);
}
function register(state, scope, formula, node2) {
  const key = formulaKey(formula);
  if (scope.queued.has(key)) return scope.map.get(key) ?? node2;
  scope.queued.add(key);
  scope.map.set(key, node2);
  scope.pending.push(node2);
  scope.saturated = false;
  addTermsOf(state, scope, formula);
  addTermsOf(state, scope, node2.goal);
  return node2;
}
function typeOfTerm(term, sig) {
  try {
    return termType(term, sig);
  } catch {
    return null;
  }
}
function sameType(term, type, sig) {
  const t = typeOfTerm(term, sig);
  return t !== null && deepEqual(t, type);
}
function candidatesOfType(state, scope, type, limit = 32) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of scope.terms) {
    if (out.length >= limit) break;
    const key = formulaKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    if (sameType(t, type, scope.sig)) out.push(t);
  }
  return out;
}
var eigenCounter = 0;
var rewriteVarCounter = 0;
function eigenVariable2(state, scope, type) {
  const used = new Set(Object.keys(scope.sig.constants));
  for (const node2 of scope.nodeEntries()) for (const n of allNames(node2.goal)) used.add(n);
  for (; ; ) {
    const name = `e${eigenCounter}`;
    eigenCounter += 1;
    if (!used.has(name)) return V(name, type);
  }
}
function freshRewriteVariable(forbidden) {
  for (; ; ) {
    const name = `r${rewriteVarCounter}`;
    rewriteVarCounter += 1;
    if (!forbidden.has(name)) return name;
  }
}
function termVariants(term, lhs, variable, limit) {
  if (deepEqual(term, lhs)) return [variable];
  if (!Array.isArray(term)) return [];
  if (term[0] === "app") {
    const out = [];
    for (const v of termVariants(term[1], lhs, variable, limit)) out.push(App(v, term[2]));
    for (const v of termVariants(term[2], lhs, variable, limit)) out.push(App(term[1], v));
    return out.slice(0, limit);
  }
  return [];
}
function formulaVariants(formula, lhs, variable, limit) {
  if (!Array.isArray(formula) || formula.length === 0) return [];
  switch (formula[0]) {
    case "eq": {
      const out = [];
      for (const v of termVariants(formula[1], lhs, variable, limit)) out.push(Eq(v, formula[2]));
      for (const v of termVariants(formula[2], lhs, variable, limit)) out.push(Eq(formula[1], v));
      return out.slice(0, limit);
    }
    case "imp":
    case "and":
    case "or":
      return [
        ...formulaVariants(formula[1], lhs, variable, limit),
        ...formulaVariants(formula[2], lhs, variable, limit)
      ].slice(0, limit);
    case "all":
    case "ex":
      return formulaVariants(formula[2], lhs, variable, limit);
    default:
      return [];
  }
}
function rewriteWithEquation(state, scope, eqNode, push) {
  const eq2 = eqNode.goal;
  if (eq2[0] !== "eq" || deepEqual(eq2[1], eq2[2])) return;
  const [l, r] = [eq2[1], eq2[2]];
  const lType = typeOfTerm(l, scope.sig);
  if (lType === null) return;
  for (const [, node2] of scope.entries()) {
    const phi = node2.goal;
    if (deepEqual(phi, eq2)) continue;
    const forbidden = /* @__PURE__ */ new Set([...allNames(phi), ...allNames(l), ...allNames(r)]);
    const variable = V(freshRewriteVariable(forbidden), lType);
    for (const context of formulaVariants(phi, l, variable, 8)) {
      if (deepEqual(context, phi)) continue;
      state.states += 1;
      let applied;
      let rewritten;
      try {
        applied = fsub(context, variable, l);
        rewritten = fsub(context, variable, r);
      } catch {
        continue;
      }
      if (!deepEqual(applied, phi) || deepEqual(rewritten, phi)) continue;
      let node22;
      try {
        node22 = eqRewrite(eqNode, node2, variable, context);
      } catch {
        continue;
      }
      if (push(rewritten, node22)) return;
    }
  }
}
function bridgeLogic(scope, formula, node2, push) {
  if (isTruthEq(formula)) {
    const app3 = formula[1];
    if (Array.isArray(app3) && app3[0] === "app" && Array.isArray(app3[1]) && app3[1][0] === "app") {
      const op = app3[1][1]?.[1];
      if (Array.isArray(app3[1][1]) && app3[1][1][0] === "logic" && BRIDGE_OPS.includes(op)) {
        const p = app3[1][2];
        const q = app3[2];
        const ax = axiomNode({ schema: "logic", op }, scope.sig);
        const inst = allElim(allElim(ax, p), q);
        push([op, B2(p), B2(q)], impElim(andElimLeft(inst), node2));
        return;
      }
    }
  }
  if (formula[0] === "and" && isTruthEq(formula[1]) && isTruthEq(formula[2])) {
    const p = formula[1][1];
    const q = formula[2][1];
    const ax = axiomNode({ schema: "logic", op: "and" }, scope.sig);
    const inst = allElim(allElim(ax, p), q);
    push(B2(App(App(L2("and"), p), q)), impElim(andElimRight(inst), node2));
    return;
  }
  if (formula[0] === "imp" && isTruthEq(formula[1]) && isTruthEq(formula[2])) {
    const p = formula[1][1];
    const q = formula[2][1];
    const ax = axiomNode({ schema: "logic", op: "imp" }, scope.sig);
    const inst = allElim(allElim(ax, p), q);
    push(B2(App(App(L2("imp"), p), q)), impElim(andElimRight(inst), node2));
  }
}
function bridgeEquality(state, scope, formula, node2, push) {
  if (state.vocab.objEq.size === 0) return;
  if (isTruthEq(formula)) {
    const app3 = formula[1];
    if (Array.isArray(app3) && app3[0] === "app" && Array.isArray(app3[1]) && app3[1][0] === "app" && Array.isArray(app3[1][1]) && app3[1][1][0] === "logic" && app3[1][1][1] === "eq") {
      const type = app3[1][1][2];
      if (!state.vocab.objEq.has(JSON.stringify(type))) return;
      const l = app3[1][2];
      const r = app3[2];
      const ax = axiomNode({ schema: "equality", type }, scope.sig);
      const inst = allElim(allElim(ax, l), r);
      push(Eq(l, r), impElim(andElimLeft(inst), node2));
    }
    return;
  }
  if (formula[0] === "eq") {
    const [l, r] = [formula[1], formula[2]];
    const type = typeOfTerm(l, scope.sig);
    if (type === null || !state.vocab.objEq.has(JSON.stringify(type))) return;
    const ax = axiomNode({ schema: "equality", type }, scope.sig);
    const inst = allElim(allElim(ax, l), r);
    push(B2(App(App(L2("eq", type), l), r)), impElim(andElimRight(inst), node2));
  }
}
function bridgeQuantifier(state, scope, formula, node2, push) {
  if (state.vocab.quant.size === 0) return;
  if (!isTruthEq(formula)) return;
  const app3 = formula[1];
  if (!Array.isArray(app3) || app3[0] !== "app" || !Array.isArray(app3[1])) return;
  const head = app3[1];
  if (head[0] !== "logic" || !["all", "ex"].includes(head[1]) || !state.vocab.quant.has(head[1])) return;
  const type = head[2];
  const pred = app3[2];
  const ax = axiomNode({ schema: "quantifier", op: head[1], type }, scope.sig);
  const inst = allElim(ax, pred);
  const x = V("x", type);
  push([head[1], x, B2(App(pred, x))], impElim(andElimLeft(inst), node2));
}
function bridgeAbstraction(scope, formula, push) {
  const redexes = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = (n) => {
    if (!Array.isArray(n)) return;
    if (n[0] === "app" && Array.isArray(n[1]) && n[1][0] === "lift") {
      const key = formulaKey(n);
      if (!seen.has(key)) {
        seen.add(key);
        redexes.push(n);
      }
    }
    for (const a of n) if (Array.isArray(a)) walk(a);
  };
  walk(formula);
  for (const redex of redexes) {
    const liftSymbol = redex[1];
    const arg = redex[2];
    if (!sameType(arg, liftSymbol[1][1], scope.sig)) continue;
    let inst;
    try {
      inst = axiomNode(abstractionInstance(liftSymbol[1], scope.sig), scope.sig);
      for (const param of liftSymbol[2]) inst = allElim(inst, param);
      inst = allElim(inst, arg);
    } catch {
      continue;
    }
    push(inst.goal, inst);
  }
}
var SATURATION_CAP = 2500;
function saturate(state, scope, targetKey = null) {
  if (scope.saturated) return targetKey ? scope.lookup(targetKey) !== null : true;
  const push = (formula, node2) => {
    const key = formulaKey(formula);
    if (scope.queued.has(key)) return false;
    if (scope.pushed >= SATURATION_CAP) {
      scope.capped = true;
      state.capped = true;
      return false;
    }
    state.states += 1;
    if (state.states > state.maxStates) budget(state, "\u72B6\u6001\u6570");
    scope.pushed += 1;
    scope.queued.add(key);
    scope.map.set(key, node2);
    addTermsOf(state, scope, formula);
    addTermsOf(state, scope, node2.goal);
    scope.pending.push(node2);
    if (state.onPush) state.onPush(formula, scope);
    return true;
  };
  while (scope.pending.length) {
    if (targetKey && scope.lookup(targetKey)) return true;
    if (Date.now() - state.started > state.maxMs) budget(state, "\u65F6\u95F4");
    if (state.steps > state.maxSteps) budget(state, "\u6B65\u6570");
    const node2 = scope.pending.shift();
    const f = node2.goal;
    if (!Array.isArray(f)) continue;
    try {
      if (f[0] === "and") {
        push(f[1], andElimLeft(node2));
        push(f[2], andElimRight(node2));
      } else if (f[0] === "imp") {
        const ante = scope.lookup(formulaKey(f[1]));
        if (ante) push(f[2], impElim(node2, ante));
        else if (f[1][0] === "eq" && deepEqual(f[1][1], f[1][2])) {
          push(f[2], impElim(node2, reflNode(f[1][1])));
        }
      } else if (f[0] === "all") {
        const pool = candidatesOfType(state, scope, f[1][2], 24);
        const preferred = pool.filter((term) => state.goalTermKeys.has(safeFormulaKey(term)));
        const rest = pool.filter((term) => !preferred.includes(term));
        const terms = preferred.length ? [...preferred.slice(0, 8), ...rest.slice(0, 2)] : pool.slice(0, 6);
        for (const term of terms) {
          try {
            push(fsub(f[2], f[1], term), allElim(node2, term));
          } catch {
          }
        }
      } else if (f[0] === "eq") {
        bridgeEquality(state, scope, f, node2, push);
        bridgeQuantifier(state, scope, f, node2, push);
        rewriteWithEquation(state, scope, node2, push);
      }
      if (isTruthEq(f) || f[0] === "and" || f[0] === "imp") bridgeLogic(scope, f, node2, push);
      bridgeAbstraction(scope, f, push);
    } catch (error) {
      if (error instanceof FormalError && error.status === "timeout") throw error;
      state.skipped += 1;
      if (state.notes.length < 20) state.notes.push(`\u9971\u548C\u8DF3\u8FC7\uFF1A${error.message}`);
      trace(state, `\u8DF3\u8FC7\u4E00\u6B65\uFF1A${error.message}`);
    }
  }
  scope.saturated = true;
  return targetKey ? scope.lookup(targetKey) !== null : true;
}
function scanBridgeVocabulary(formulas) {
  const objEq = /* @__PURE__ */ new Set();
  const quant = /* @__PURE__ */ new Set();
  const walk = (n) => {
    if (!Array.isArray(n)) return;
    if (n[0] === "logic") {
      if (n[1] === "eq" && n.length === 3) objEq.add(JSON.stringify(n[2]));
      if ((n[1] === "all" || n[1] === "ex") && n.length === 3) quant.add(n[1]);
    }
    for (const a of n) if (Array.isArray(a)) walk(a);
  };
  for (const f of formulas) if (f !== void 0 && f !== null) walk(f);
  return { objEq, quant };
}
function safeFormulaKey(node2) {
  try {
    return formulaKey(node2);
  } catch {
    return null;
  }
}
function noteGoalTerms(state, formula) {
  try {
    for (const term of subterms(formula)) {
      const key = safeFormulaKey(term);
      if (key !== null) state.goalTermKeys.add(key);
    }
  } catch {
  }
}
function proveFormula(state, scope, formula, depth) {
  state.depth = Math.max(state.depth, depth);
  noteGoalTerms(state, formula);
  if (state.trace && state.traceCalls < 240) {
    state.traceCalls += 1;
    trace(state, `prove(d=${depth}) ${JSON.stringify(formula).slice(0, Number(process.env.TRACE_WIDTH ?? 120))}`);
  }
  if (depth > state.maxDepth) budget(state, "\u6DF1\u5EA6");
  if (Date.now() - state.started > state.maxMs) budget(state, "\u65F6\u95F4");
  if (state.steps > state.maxSteps) budget(state, "\u6B65\u6570");
  const key = formulaKey(formula);
  const direct = scope.lookup(key);
  if (direct) return direct;
  const k = formula[0];
  if (k === "and") {
    const left = proveFormula(state, scope, formula[1], depth + 1);
    if (left) {
      const right = proveFormula(state, scope, formula[2], depth + 1);
      if (right) return andIntro(left, right);
    }
    return saturateAndLookup(state, scope, formula, key) ? scope.lookup(key) : null;
  }
  if (k === "imp") {
    const inner = new Scope(scope, scope.sig);
    state.hypothesisSeq += 1;
    const label = `h${state.hypothesisSeq}`;
    const antecedent = formula[1];
    try {
      const hypNode = hypothesisNode(label, antecedent);
      register(state, inner, antecedent, hypNode);
      if (antecedent[0] === "ex") {
        const eigen = eigenVariable2(state, inner, antecedent[1][2]);
        const caseLabel = `${label}_case`;
        const caseFormula = fsub(antecedent[2], antecedent[1], eigen);
        const caseNode = hypothesisNode(caseLabel, caseFormula);
        register(state, inner, caseFormula, caseNode);
        const body = proveFormula(state, inner, formula[2], depth + 1);
        if (body) return impIntro(exElim(hypNode, body, caseLabel, eigen), label, antecedent);
      } else {
        const body = proveFormula(state, inner, formula[2], depth + 1);
        if (body) return impIntro(body, label, antecedent);
      }
    } catch (error) {
      if (error instanceof FormalError && error.status === "timeout") throw error;
      trace(state, `\u8574\u542B\u76EE\u6807\u5931\u8D25\uFF1A${error.message}`);
    }
    return saturateAndLookup(state, scope, formula, key) ? scope.lookup(key) : null;
  }
  if (k === "all") {
    const inner = new Scope(scope, scope.sig);
    const eigen = eigenVariable2(state, inner, formula[1][2]);
    const instance = fsub(formula[2], formula[1], eigen);
    const body = proveFormula(state, inner, instance, depth + 1);
    if (body) return allIntro(body, eigen);
    return saturateAndLookup(state, scope, formula, key) ? scope.lookup(key) : null;
  }
  if (k === "ex") {
    for (const term of candidatesOfType(state, scope, formula[1][2], 32)) {
      let instance;
      try {
        instance = fsub(formula[2], formula[1], term);
      } catch {
        continue;
      }
      const body = proveFormula(state, scope, instance, depth + 1);
      if (body) return exIntro(formula, term, body);
    }
    return saturateAndLookup(state, scope, formula, key) ? scope.lookup(key) : null;
  }
  if (k === "false") throw new FormalError("false \u5728\u9996\u7248\u4E0D\u53EF\u8BC1\uFF08\u6CA1\u6709 false_e \u89C4\u5219\uFF09", "unsupported");
  if (k === "or") throw new FormalError("\u8BA4\u8BC1\u8BED\u8A00\u4E0D\u63A5\u53D7\u6790\u53D6\uFF08\u5185\u6838\u6CA1\u6709 or \u89C4\u5219\uFF09", "unsupported");
  if (state.atomicStack.has(key)) return null;
  state.atomicStack.add(key);
  try {
    if (generateAbstractionFor(state, scope, formula)) {
      saturate(state, scope, key);
      const direct2 = scope.lookup(key);
      if (direct2) return direct2;
    }
    const quick = proveAtomicGuided(state, scope, formula, depth, { rewrite: false, axiomInstance: false });
    if (quick) return quick;
    if (saturateAndLookup(state, scope, formula, key)) return scope.lookup(key);
    const guided = proveAtomicGuided(state, scope, formula, depth);
    if (guided) return guided;
    return null;
  } finally {
    state.atomicStack.delete(key);
  }
}
function proveAtomicGuided(state, scope, goal, depth, { rewrite = true, axiomInstance: axiomInstance2 = true } = {}) {
  if (goal[0] === "eq" && deepEqual(goal[1], goal[2])) return reflNode(goal[1]);
  const bridged = proveByBackwardBridge(state, scope, goal, depth);
  if (bridged) return bridged;
  if (axiomInstance2) {
    const viaAxiom = proveViaAxiomInstance(state, scope, goal, depth);
    if (viaAxiom) return viaAxiom;
  }
  const viaMeta = proveAtomicViaMeta(state, scope, goal);
  if (viaMeta) return viaMeta;
  return rewrite ? proveByRewrite(state, scope, goal, depth) : null;
}
function matchInstance(pattern, target, env, fuel = { left: 4096 }) {
  if (fuel.left <= 0) return false;
  fuel.left -= 1;
  const p = deref(pattern, env);
  if (isMeta(p)) {
    const bound = env.get(p[1]);
    if (bound === void 0) {
      env.set(p[1], target);
      return true;
    }
    return deepEqual(deref(bound, env), target);
  }
  if (!Array.isArray(p) || !Array.isArray(target)) return deepEqual(p, target);
  if (p.length !== target.length) return false;
  if (p[0] === "?" || p[0] !== target[0]) return false;
  for (let index = 1; index < p.length; index += 1) {
    if (!matchInstance(p[index], target[index], env, fuel)) return false;
  }
  return true;
}
function proveViaAxiomInstance(state, scope, goal, depth) {
  let tried = 0;
  for (const node2 of scope.nodeEntries()) {
    if (tried >= 24) break;
    const fact = node2.goal;
    if (!Array.isArray(fact) || fact[0] !== "all") continue;
    tried += 1;
    const binders = [];
    let body = fact;
    while (Array.isArray(body) && body[0] === "all") {
      binders.push(body[1]);
      body = body[2];
    }
    const metas = binders.map((binder) => freshMeta("q", binder[2]));
    let pattern;
    try {
      pattern = body;
      for (let i = binders.length - 1; i >= 0; i -= 1) pattern = fsub(pattern, binders[i], metas[i]);
    } catch {
      continue;
    }
    for (const side of axiomSides(pattern)) {
      const env = /* @__PURE__ */ new Map();
      if (!matchInstance(side.conclusion, goal, env)) continue;
      if (state.trace) trace(state, `  [axiom-instance] \u5F62\u72B6\u547D\u4E2D\uFF1A${JSON.stringify(fact).slice(0, 70)}`);
      const terms = metas.map((meta) => applyEnv(meta, env));
      if (terms.some((term) => !isGround(term, env))) continue;
      if (terms.some((term, index) => !sameType(term, binders[index][2], scope.sig))) {
        if (state.trace) trace(state, "  [axiom-instance] \u5B9E\u4F8B\u9879\u7C7B\u578B\u4E0D\u5408\uFF0C\u8DF3\u8FC7");
        continue;
      }
      const premise = applyEnv(side.premise, env);
      if (!isGround(premise)) {
        if (state.trace) trace(state, "  [axiom-instance] \u524D\u4EF6\u4ECD\u6709\u672A\u5B9A\u5143\u53D8\u91CF\uFF0C\u8DF3\u8FC7");
        continue;
      }
      let inst = node2;
      try {
        for (const term of terms) inst = allElim(inst, term);
      } catch {
        continue;
      }
      const direction = side.pick(inst);
      if (!direction) continue;
      const conclusion = Array.isArray(direction.goal) && direction.goal[0] === "imp" ? direction.goal[2] : direction.goal;
      if (!sameFormula(conclusion, goal)) {
        if (state.trace) trace(state, `  [axiom-instance] \u7ED3\u8BBA\u4E0D\u662F\u76EE\u6807\uFF1A${JSON.stringify(conclusion).slice(0, 90)}`);
        continue;
      }
      if (state.trace) trace(state, `  [axiom-instance] \u91C7\u7528\uFF1B\u524D\u4EF6=${JSON.stringify(premise).slice(0, 90)}`);
      const other = proveFormula(state, scope, premise, depth + 1);
      if (!other) continue;
      try {
        return impElim(direction, other);
      } catch {
        continue;
      }
    }
  }
  return null;
}
function axiomSides(pattern) {
  if (!Array.isArray(pattern)) return [];
  if (pattern[0] === "imp") return [{ conclusion: pattern[2], premise: pattern[1], pick: (inst) => inst }];
  if (pattern[0] === "and" && pattern[1]?.[0] === "imp" && pattern[2]?.[0] === "imp") {
    const forward = pattern[1];
    const backward = pattern[2];
    return [
      { conclusion: forward[2], premise: forward[1], pick: (inst) => andElimLeft(inst) },
      { conclusion: backward[2], premise: backward[1], pick: (inst) => andElimRight(inst) }
    ].filter((side) => !isVacuousConclusion(side.conclusion));
  }
  return [];
}
function isVacuousConclusion(conclusion) {
  if (!Array.isArray(conclusion)) return true;
  if (isMeta(conclusion)) return true;
  if (conclusion[0] === "eq") {
    return isMeta(conclusion[1]) && isMeta(conclusion[2]);
  }
  return false;
}
function saturateAndLookup(state, scope, formula, key) {
  saturate(state, scope, key);
  return scope.lookup(key) !== null;
}
function generateAbstractionFor(state, scope, formula) {
  const redexes = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = (n) => {
    if (!Array.isArray(n)) return;
    if (n[0] === "app" && Array.isArray(n[1]) && n[1][0] === "lift") {
      const key = formulaKey(n);
      if (!seen.has(key)) {
        seen.add(key);
        redexes.push(n);
      }
    }
    for (const a of n) if (Array.isArray(a)) walk(a);
  };
  walk(formula);
  let added = false;
  for (const redex of redexes) {
    const liftSymbol = redex[1];
    const arg = redex[2];
    if (!sameType(arg, liftSymbol[1][1], scope.sig)) continue;
    let inst;
    try {
      inst = axiomNode(abstractionInstance(liftSymbol[1], scope.sig), scope.sig);
      for (const param of liftSymbol[2]) inst = allElim(inst, param);
      inst = allElim(inst, arg);
    } catch {
      continue;
    }
    const key = formulaKey(inst.goal);
    if (!scope.map.has(key)) {
      register(state, scope, inst.goal, inst);
      added = true;
    }
  }
  return added;
}
function proveByBackwardBridge(state, scope, goal, depth) {
  if (isTruthEq(goal)) {
    const app3 = goal[1];
    if (Array.isArray(app3) && app3[0] === "app" && Array.isArray(app3[1])) {
      if (app3[1][0] === "app" && Array.isArray(app3[1][1]) && app3[1][1][0] === "logic" && BRIDGE_OPS.includes(app3[1][1][1])) {
        const op = app3[1][1][1];
        const p = app3[1][2];
        const q = app3[2];
        const sub = [op, B2(p), B2(q)];
        const node2 = proveFormula(state, scope, sub, depth + 1);
        if (node2) {
          const inst = allElim(allElim(axiomNode({ schema: "logic", op }, scope.sig), p), q);
          return impElim(andElimRight(inst), node2);
        }
      }
      if (state.vocab.objEq.size > 0 && Array.isArray(app3[1]) && app3[1][0] === "app" && Array.isArray(app3[1][1]) && app3[1][1][0] === "logic" && app3[1][1][1] === "eq" && state.vocab.objEq.has(JSON.stringify(app3[1][1][2]))) {
        const type = app3[1][1][2];
        const l = app3[1][2];
        const r = app3[2];
        const node2 = proveFormula(state, scope, Eq(l, r), depth + 1);
        if (node2) {
          const inst = allElim(allElim(axiomNode({ schema: "equality", type }, scope.sig), l), r);
          return impElim(andElimRight(inst), node2);
        }
      }
      if (state.vocab.quant.size > 0 && app3[1][0] === "logic" && ["all", "ex"].includes(app3[1][1]) && state.vocab.quant.has(app3[1][1])) {
        const type = app3[1][2];
        const pred = app3[2];
        const x = V("x", type);
        const sub = [app3[1][1], x, B2(App(pred, x))];
        const node2 = proveFormula(state, scope, sub, depth + 1);
        if (node2) {
          const inst = allElim(axiomNode({ schema: "quantifier", op: app3[1][1], type }, scope.sig), pred);
          return impElim(andElimRight(inst), node2);
        }
      }
    }
    return null;
  }
  return null;
}
function proveByRewrite(state, scope, goal, depth) {
  let considered = 0;
  const goalSize = nodeCount(goal);
  const equations = [];
  for (const node2 of scope.nodeEntries()) {
    if (Array.isArray(node2.goal) && node2.goal[0] === "eq" && !deepEqual(node2.goal[1], node2.goal[2])) {
      equations.push(node2);
      if (equations.length >= 40) break;
    }
  }
  const candidates = [];
  for (const eqNode of equations) {
    const eq2 = eqNode.goal;
    const lType = typeOfTerm(eq2[1], scope.sig);
    if (lType === null) continue;
    const forbidden = /* @__PURE__ */ new Set([...allNames(goal), ...allNames(eq2)]);
    const variable = V(freshRewriteVariable(forbidden), lType);
    const attempts = [
      { lhs: eq2[2], rhs: eq2[1], node: eqNode, definitional: false },
      /*
       * 方向二（正向重写）：目标里出现等式的**左侧** → 换成右侧去证；这一步要**反向的等式**，
       * 所以按需对称化（`Eq(r,l)`，两步：refl + eq_e），而不是把它塞进前向饱和——
       * 那正是早先版本把预算烧光的原因（`true → hA` 之类的破坏性改写规则）。
       *
       * `definitional`：等式左边是**一个背景定义名**（`const_seq`、`left_mul`…）时，
       * 展开/折叠是有限且必需的一步，允许目标变大（`const_seq(aa)` → `lift(λa.λn.a)(aa)`）。
       * 其它等式仍只许化简——那是发散（越换越大）的唯一来源。
       */
      {
        lhs: eq2[1],
        rhs: eq2[2],
        node: symmetryOf(scope, eqNode),
        definitional: Array.isArray(eq2[1]) && eq2[1][0] === "c"
      }
    ];
    for (const attempt of attempts) {
      if (!attempt.node) continue;
      for (const context of formulaVariants(goal, attempt.lhs, variable, 4)) {
        if (deepEqual(context, goal)) continue;
        let psi;
        try {
          psi = fsub(context, variable, attempt.rhs);
        } catch {
          continue;
        }
        if (deepEqual(psi, goal)) continue;
        const size = nodeCount(psi);
        if (size > goalSize && !attempt.definitional) continue;
        candidates.push({ psi, size, node: attempt.node, variable, context });
        if (candidates.length >= 80) break;
      }
      if (candidates.length >= 80) break;
    }
    if (candidates.length >= 80) break;
  }
  candidates.sort((left, right) => left.size - right.size);
  for (const candidate of candidates) {
    const sub = proveFormula(state, scope, candidate.psi, depth + 1);
    if (!sub) continue;
    try {
      return eqRewrite(candidate.node, sub, candidate.variable, candidate.context);
    } catch {
      continue;
    }
  }
  return null;
}
function symmetryOf(scope, eqNode) {
  const eq2 = eqNode?.goal;
  if (!Array.isArray(eq2) || eq2[0] !== "eq" || deepEqual(eq2[1], eq2[2])) return null;
  const lType = typeOfTerm(eq2[1], scope.sig);
  if (lType === null) return null;
  const variable = V(freshRewriteVariable(new Set(allNames(eq2))), lType);
  try {
    return eqRewrite(eqNode, reflNode(eq2[1]), variable, Eq(variable, eq2[1]));
  } catch {
    return null;
  }
}
function proveAtomicViaMeta(state, scope, goal) {
  for (const node2 of scope.nodeEntries()) {
    const f = node2.goal;
    if (!Array.isArray(f) || f[0] !== "all") continue;
    const meta = freshMeta("x", f[1][2]);
    let pattern;
    try {
      pattern = fsub(f[2], f[1], meta);
    } catch {
      continue;
    }
    const env = /* @__PURE__ */ new Map();
    if (!unify(pattern, goal, env, scope.sig)) continue;
    const witness = applyEnv(meta, env);
    if (!isGround(witness, env)) continue;
    if (!sameType(witness, f[1][2], scope.sig)) continue;
    try {
      const inst = allElim(node2, witness);
      if (formulaKey(inst.goal) === formulaKey(goal)) return inst;
    } catch {
      continue;
    }
  }
  return null;
}
function formulaFromAtoms(atoms) {
  need(Array.isArray(atoms) && atoms.length > 0, "atoms \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4", "error");
  const [head, ...body] = atoms;
  return clauseToFormula({ head, body });
}
function registerProgram(state, scope, program, sig) {
  const nodes = [];
  for (const hyp of program.hypotheses ?? []) {
    need(hyp && typeof hyp.id === "string", "\u7A0B\u5E8F\u5047\u8BBE\u7F3A\u5C11 id", "error");
    formulaOk(hyp.formula, sig);
    const node2 = hypothesisNode(hyp.id, hyp.formula);
    register(state, scope, hyp.formula, node2);
    nodes.push(node2);
  }
  for (const entry of program.clauses ?? []) {
    need(entry && typeof entry.id === "string", "\u7A0B\u5E8F\u5B50\u53E5\u7F3A\u5C11 id", "error");
    const kind = entry.kind ?? "hypothesis";
    if (kind === "hypothesis") {
      const formula = entry.formula ?? (entry.atoms ? formulaFromAtoms(entry.atoms) : null);
      need(formula, `\u7A0B\u5E8F\u6761\u76EE ${entry.id} \u7F3A\u5C11 formula/atoms`, "error");
      formulaOk(formula, sig);
      const node2 = hypothesisNode(entry.id, formula);
      register(state, scope, formula, node2);
      nodes.push(node2);
    } else if (kind === "axiom") {
      const formula = entry.formula ?? entry.conclusion ?? (entry.atoms ? formulaFromAtoms(entry.atoms) : null);
      need(formula, `\u516C\u7406\u6761\u76EE ${entry.id} \u7F3A\u5C11 formula`, "error");
      formulaOk(formula, sig);
      const node2 = theoryNode(entry.theoryAxiomId ?? entry.id, formula);
      register(state, scope, formula, node2);
      nodes.push(node2);
    } else if (kind === "definition") {
      const name = entry.definitionName ?? entry.id;
      const def = (sig.definitions ?? []).find((d) => d.name === name);
      const formula = entry.formula ?? (def ? Eq(C(name), lift(def.term, sig)) : null);
      need(formula, `\u5B9A\u4E49\u6761\u76EE ${entry.id} \u65E2\u6CA1\u6709 formula\uFF0C\u4E5F\u4E0D\u662F sig \u91CC\u5DF2\u767B\u8BB0\u7684\u5B9A\u4E49`, "error");
      const node2 = definitionNode(name, formula);
      register(state, scope, formula, node2);
      nodes.push(node2);
    } else if (kind === "lemma") {
      const formula = entry.formula ?? entry.conclusion;
      need(formula, `\u5F15\u7406\u6761\u76EE ${entry.id} \u7F3A\u5C11 conclusion/formula`, "error");
      formulaOk(formula, sig);
      const node2 = lemmaNode(entry.lemmaId ?? entry.id, formula);
      register(state, scope, formula, node2);
      nodes.push(node2);
    } else {
      throw new FormalError(`\u7A0B\u5E8F\u6761\u76EE ${entry.id} \u7684 kind \u672A\u77E5\uFF1A${kind}`, "error");
    }
  }
  return nodes;
}
function search(goal, program = {}, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rawSig = opts.sig ?? { bases: ["o"], constants: {}, definitions: [] };
  const state = {
    sig: rawSig,
    trace: Boolean(opts.trace),
    traceLines: [],
    maxDepth: opts.maxDepth,
    maxStates: opts.maxStates,
    maxMs: opts.maxMs,
    maxSteps: opts.maxSteps,
    started: Date.now(),
    states: 0,
    steps: 0,
    depth: 0,
    skipped: 0,
    notes: [],
    hypothesisSeq: 0,
    traceCalls: 0,
    atomicStack: /* @__PURE__ */ new Set(),
    goalTermKeys: /* @__PURE__ */ new Set(),
    onPush: typeof opts.onPush === "function" ? opts.onPush : null
  };
  const stats = () => ({
    depth: state.depth,
    states: state.states,
    steps: state.steps,
    durationMs: Date.now() - state.started,
    reasonDetail: state.notes.slice(-5).join(" | ") || null
  });
  let sig;
  try {
    sig = ensureSig(rawSig);
  } catch (error) {
    const status = error instanceof FormalError && error.status === "unsupported" ? "unsupported" : "error";
    return { status, proof: null, reason: `sig \u4E0D\u5408\u6CD5\uFF1A${error.message}`, stats: stats() };
  }
  state.sig = sig;
  let formula;
  let objectConclusion;
  let goalSource = null;
  try {
    if (typeof goal === "string") {
      goalSource = goal;
      formula = parseSourceFormula(goal, opts, sig);
    } else if (isCertFormula(goal)) {
      formula = goal;
    } else {
      objectConclusion = goal;
      formula = B2(goal);
    }
    formulaOk(formula, sig);
  } catch (error) {
    const status = error instanceof FormalError && error.status === "unsupported" ? "unsupported" : "error";
    return {
      status,
      proof: null,
      reason: `\u76EE\u6807\u4E0D\u5408\u6CD5\uFF1A${error.message}`,
      stats: stats(),
      ...goalSource === null ? {} : { goalSource }
    };
  }
  let prog = program;
  try {
    prog = resolveProgram(program, opts, sig);
  } catch (error) {
    const status = error instanceof FormalError && error.status === "unsupported" ? "unsupported" : "error";
    return {
      status,
      proof: null,
      reason: `\u7A0B\u5E8F\u4E0D\u5408\u6CD5\uFF1A${error.message}`,
      stats: stats(),
      goal: formula,
      ...goalSource === null ? {} : { goalSource }
    };
  }
  try {
    const scope = new Scope(null, sig);
    const vocabFormulas = [formula];
    for (const hyp of prog.hypotheses ?? []) if (hyp?.formula) vocabFormulas.push(hyp.formula);
    for (const entry of prog.clauses ?? []) {
      if (entry?.formula) vocabFormulas.push(entry.formula);
      if (entry?.conclusion) vocabFormulas.push(entry.conclusion);
    }
    state.vocab = scanBridgeVocabulary(vocabFormulas);
    addTermsOf(state, scope, formula);
    registerProgram(state, scope, prog, sig);
    clausifyFormula(formula, sig, { role: "goal" });
    for (const hyp of prog.hypotheses ?? []) clausifyFormula(hyp.formula, sig, { role: "fact" });
    for (const entry of prog.clauses ?? []) {
      if ((entry.kind ?? "hypothesis") === "hypothesis" && entry.formula) {
        clausifyFormula(entry.formula, sig, { role: "fact" });
      }
    }
    const proof = proveFormula(state, scope, formula, 0);
    state.steps = countNodes(proof);
    if (state.steps > state.maxSteps) budget(state, "\u6B65\u6570");
    if (!proof) {
      if (state.capped) {
        return {
          status: "timeout",
          proof: null,
          reason: `\u524D\u5411\u9971\u548C\u8FBE\u5230\u5DE5\u7A0B\u4E0A\u9650\uFF08${SATURATION_CAP} \u6761\uFF09\uFF0C\u641C\u7D22\u7A7A\u95F4\u6CA1\u6709\u7A77\u5C3D\uFF1A\u8FD9\u4E0D\u7B49\u4E8E\u5426\u8BC1\uFF0C\u4E5F\u4E0D\u7B49\u4E8E"\u5728\u9884\u7B97\u5185\u6CA1\u627E\u5230"\u3002`,
          stats: stats(),
          goal: formula,
          ...goalSource === null ? {} : { goalSource }
        };
      }
      return {
        status: "undecided",
        proof: null,
        reason: "\u5728\u7ED9\u5B9A\u9884\u7B97\u5185\u6CA1\u6709\u627E\u5230\u8BC1\u660E\uFF08\u8FD9\u65E2\u4E0D\u662F\u8BC1\u660E\uFF0C\u4E5F\u4E0D\u662F\u53CD\u8BC1\uFF09",
        stats: stats(),
        goal: formula,
        ...goalSource === null ? {} : { goalSource }
      };
    }
    return {
      status: "proved",
      proof,
      reason: "\u627E\u5230\u4E00\u68F5\u53EF\u88C5\u914D\u6210 kernel \u8BC1\u4E66\u7684\u67E5\u8BC1\u6811",
      stats: stats(),
      goal: formula,
      objectConclusion,
      ...goalSource === null ? {} : { goalSource }
    };
  } catch (error) {
    if (error instanceof FormalError) {
      const status = error.status === "timeout" ? "timeout" : error.status === "unsupported" ? "unsupported" : "error";
      return {
        status,
        proof: null,
        reason: error.message,
        stats: stats(),
        goal: formula,
        ...goalSource === null ? {} : { goalSource }
      };
    }
    return {
      status: "error",
      proof: null,
      reason: `\u641C\u7D22\u6267\u884C\u9519\u8BEF\uFF1A${error.message}`,
      stats: stats(),
      goal: formula,
      ...goalSource === null ? {} : { goalSource }
    };
  }
}
function countNodes(node2, seen = /* @__PURE__ */ new Set()) {
  if (!node2 || typeof node2 !== "object" || seen.has(node2)) return 0;
  seen.add(node2);
  let total = 1;
  for (const p of node2.premises ?? []) total += countNodes(p, seen);
  return total;
}
function nodeCount(node2) {
  if (!Array.isArray(node2)) return 1;
  let total = 1;
  for (const item of node2) total += nodeCount(item);
  return total;
}
function collectHypotheses(node2, seed = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set()) {
  if (!node2 || typeof node2 !== "object" || seen.has(node2)) return seed;
  seen.add(node2);
  if (node2.rule === "hypothesis") {
    const label = node2.hypothesis?.id ?? node2.hypothesis?.name;
    if (label) seed.set(label, node2.goal);
  } else if (node2.rule === "imp_i") {
    const label = node2.discharge;
    if (label && !seed.has(label) && Array.isArray(node2.goal) && node2.goal[0] === "imp") seed.set(label, node2.goal[1]);
  } else if (node2.rule === "ex_e") {
    const label = node2.discharge;
    const exPremise = node2.premises?.[0];
    if (label && !seed.has(label) && Array.isArray(exPremise?.goal) && exPremise.goal[0] === "ex") {
      seed.set(label, fsub(exPremise.goal[2], exPremise.goal[1], node2.eigen));
    }
  }
  for (const p of node2.premises ?? []) collectHypotheses(p, seed, seen);
  return seed;
}

// ../mcs-web/shared/contracts.mjs
var CONSTRUCTS = Object.freeze([
  "Symbol",
  "Term",
  "Concept",
  "Definition",
  "Claim",
  "Proof",
  "Example",
  "Counterexample",
  "Problem",
  "Theory",
  "Construction",
  "Method",
  "Representation",
  "MisconceptionPattern"
]);
var ROLES = Object.freeze([
  "Concept",
  "Definition",
  "Axiom",
  "Theorem",
  "Property",
  "Proof",
  "Example",
  "Counterexample",
  "Problem",
  "Theory",
  "Construction",
  "GlobalMethod",
  "LocalMethod"
]);
var CLAIM_ROLES = Object.freeze(["Axiom", "Theorem", "Property"]);
var RESOURCE_KINDS = Object.freeze([
  "statement",
  "definition",
  "proof",
  "certificate",
  "construction",
  "task",
  "method",
  "representation",
  "condition",
  "competence"
]);
var EVIDENCE_STATUS = Object.freeze([
  "DEF",
  "PROOF",
  "REF",
  "FINITE",
  "ILLUSTRATION",
  "NOT-CLAIMED"
]);
var CHECK_STATUS = Object.freeze([
  "not_run",
  "passed",
  "failed",
  "unsupported",
  "resource_exhausted",
  "corrupt"
]);
var SUPPORT_USES = Object.freeze(["expression", "proof", "route"]);
var EVENT_KINDS = Object.freeze([
  "view",
  "hint",
  "answer",
  "evaluation",
  "mastery_estimate",
  "confirmation",
  "misconception",
  "goal",
  "note",
  "tutor_message"
]);
var PLAN_STATUS = Object.freeze([
  "Found",
  "Conditional",
  "InfeasibleWithinBound",
  "Unknown"
]);

// src/core.mjs
var object = (v) => v && typeof v === "object" && !Array.isArray(v);
function stable(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v ?? null)).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).filter((k) => value[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function relationInput(r, context = {}) {
  return stable({
    kind: r.kind,
    inputs: r.inputs,
    output: r.output,
    nodeVersions: r.nodeVersions,
    formal: r.formal ?? null,
    ...r.kind === "definitionReference" ? { formalSources: context.formalSources ?? {}, references: (context.relations ?? []).filter((x) => x.kind === "definitionReference").map((x) => ({ id: x.id, inputs: x.inputs, output: x.output, references: x.formal?.witness?.references ?? [] })).sort((a, b) => a.id.localeCompare(b.id)) } : {}
  });
}

// ../mcs-web/core/formal/finite.mjs
var MAX_WITNESSES = 24;
var FINITE_SEMANTICS_SCOPE = "\u6709\u9650\u8BED\u4E49\uFF1A\u53EA\u5728\u672C\u6A21\u5757\u9884\u7F6E\u7684\u6709\u9650\u5BF9\u8C61\uFF08REGISTERED_MODELS\uFF09\u4E0A\u6C42\u503C\uFF0C\u91CF\u8BCD\u904D\u5386\u6574\u4E2A\u8F7D\u4F53\uFF0C\u503C\u57DF\u53EA\u6709\u5199\u6B7B\u7684\u8FD0\u7B97\u8868\uFF1B\u4E0D\u641C\u7D22\u4EFB\u610F\u6A21\u578B\uFF0C\u4E5F\u4E0D\u751F\u6210\u65B0\u6A21\u578B\u3002";
var FINITE_RESULT_SCOPE = "\u6709\u9650\u8868\u4E0A\u6210\u7ACB\u4E0D\u7B49\u4E8E\u4E00\u822C\u5B9A\u7406\uFF1A\u7ED3\u8BBA\u53EA\u5BF9\u8FD9\u5F20\u8F7D\u4F53\u4E0E\u8FD9\u5F20\u8FD0\u7B97\u8868\u8D1F\u8D23\uFF0C\u4E0D\u63A8\u5E7F\u5230\u5176\u4ED6\u9636\u6570\u3001\u5176\u4ED6\u8FD0\u7B97\uFF0C\u4E5F\u4E0D\u80FD\u4EE3\u66FF\u5BF9\u4E00\u822C\u7FA4\u3001\u5B9E\u6570\u6216\u81EA\u7136\u6570\u7B49\u65E0\u9650\u7ED3\u6784\u7684\u8BC1\u660E\u3002";
var FINITE_COUNTEREXAMPLE_SCOPE = "\u6709\u9650\u53CD\u6A21\u578B\u53EA\u53CD\u9A73\u300C\u8BE5\u80CC\u666F\u4E0E\u8BE5\u7EC4\u524D\u63D0\u4E0B\u7684\u8574\u542B\u300D\uFF0C\u4E0D\u5BA3\u79F0\u63A8\u7FFB\u5B9E\u6570\u3001\u6D41\u5F62\u6216\u4E00\u822C\u7FA4\u8BBA\u4E2D\u7684\u7ED3\u8BBA\u3002";
var INFINITE_STRUCTURE_BOUNDARY = "\u211D\u3001\u2115\u3001\u4E00\u822C\u7FA4\u7B49\u65E0\u9650\u7ED3\u6784\u4E0D\u80FD\u7528\u6709\u9650\u6837\u672C\u5192\u5145\u5B8C\u6574\u6A21\u578B\uFF1A\u8FD9\u91CC\u901A\u8FC7\u7684\u68C0\u67E5\u53EA\u8BF4\u660E\u300C\u5728\u8FD9\u5F20\u6709\u9650\u8FD0\u7B97\u8868\u4E0A\u6210\u7ACB\u300D\u3002";
function scopeText(...parts) {
  return parts.filter(Boolean).join("");
}
var bad = (message, details) => new McsError(CODES.BAD_REQUEST, message, 400, details);
var unsupported = (message, details) => new McsError(CODES.EVIDENCE_UNSUPPORTED, message, 400, details);
var ARROW = "->";
function isArrow2(type) {
  return Array.isArray(type) && type.length === 3 && type[0] === ARROW;
}
function isAtom(type) {
  return typeof type === "string" && type.length > 0 && !type.includes(ARROW) && !/\s/.test(type);
}
function normalizeType(type) {
  if (typeof type === "string") {
    const text = type.trim();
    if (!text) throw bad("\u7C7B\u578B\u4E0D\u80FD\u4E3A\u7A7A");
    const parts = text.split(ARROW).map((part) => part.trim());
    if (parts.some((part) => part.length === 0)) throw bad(`\u7C7B\u578B\u5199\u6CD5\u975E\u6CD5\uFF1A${type}`);
    if (parts.length === 1) {
      if (!isAtom(parts[0])) throw bad(`\u7C7B\u578B\u91CC\u7684\u539F\u5B50\u7C7B\u578B\u540D\u975E\u6CD5\uFF1A${parts[0]}`);
      return parts[0];
    }
    let node2 = parts[parts.length - 1];
    for (let i = parts.length - 2; i >= 0; i -= 1) node2 = [ARROW, parts[i], node2];
    return normalizeType(node2);
  }
  if (isArrow2(type)) return [ARROW, normalizeType(type[1]), normalizeType(type[2])];
  if (isAtom(type)) return type;
  throw bad(`\u7C7B\u578B\u5FC5\u987B\u662F\u539F\u5B50\u7C7B\u578B\u540D\u6216 ['->', a, b]\uFF1A${JSON.stringify(type)}`);
}
function typeToText(type) {
  const node2 = normalizeType(type);
  if (isArrow2(node2)) {
    const left = isArrow2(node2[1]) ? `(${typeToText(node2[1])})` : typeToText(node2[1]);
    return `${left} ${ARROW} ${typeToText(node2[2])}`;
  }
  return node2;
}
function typeEquals2(a, b) {
  const left = normalizeType(a);
  const right = normalizeType(b);
  if (isArrow2(left) !== isArrow2(right)) return false;
  if (!isArrow2(left)) return left === right;
  return typeEquals2(left[1], right[1]) && typeEquals2(left[2], right[2]);
}
function arrowArity(type) {
  let node2 = normalizeType(type);
  let count = 0;
  while (isArrow2(node2)) {
    count += 1;
    node2 = node2[2];
  }
  return count;
}
function typeAfterArgs(type, applied) {
  let node2 = normalizeType(type);
  for (let i = 0; i < applied; i += 1) node2 = node2[2];
  return node2;
}
function typeInputs(type) {
  const inputs = [];
  let node2 = normalizeType(type);
  while (isArrow2(node2)) {
    inputs.push(node2[1]);
    node2 = node2[2];
  }
  return inputs;
}
function typeCodomain(type) {
  let node2 = normalizeType(type);
  while (isArrow2(node2)) node2 = node2[2];
  return node2;
}
function typeAtoms(type, into = []) {
  const node2 = normalizeType(type);
  if (isArrow2(node2)) {
    typeAtoms(node2[1], into);
    typeAtoms(node2[2], into);
  } else {
    into.push(node2);
  }
  return into;
}
function jsonString(text) {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "	") out += "\\t";
    else if (code < 32 || code > 126) {
      if (code > 65535) {
        const rest = code - 65536;
        const high = 55296 + (rest >> 10);
        const low = 56320 + (rest & 1023);
        out += `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return `${out}"`;
}
function stableKey(value) {
  if (value === null) return "null";
  if (typeof value === "string") return jsonString(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableKey(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${jsonString(key)}:${stableKey(value[key])}`).join(",")}}`;
  }
  throw bad(`\u65E0\u6CD5\u89C4\u8303\u5E8F\u5217\u5316\u7684\u503C\uFF1A${String(value)}`);
}
function compareStable(a, b) {
  const left = stableKey(a);
  const right = stableKey(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
function parameters2(term) {
  const found = /* @__PURE__ */ new Map();
  const walk = (node2) => {
    if (!Array.isArray(node2) || node2.length === 0) return;
    if (node2[0] === "v") {
      const type = normalizeType(node2[2]);
      const prior = found.get(node2[1]);
      if (prior && !typeEquals2(prior, type)) throw bad(`\u81EA\u7531\u53D8\u91CF ${node2[1]} \u51FA\u73B0\u4E24\u79CD\u7C7B\u578B`);
      found.set(node2[1], type);
      return;
    }
    if (node2[0] === "app") {
      walk(node2[1]);
      walk(node2[2]);
      return;
    }
    if (node2[0] === "lam") walk(node2[2]);
  };
  walk(term);
  return [...found.entries()].map(([name, type]) => ["v", name, type]).sort(compareStable);
}
function formulaFreeVars(formula, bound = /* @__PURE__ */ new Set(), into = /* @__PURE__ */ new Set()) {
  const termVars = (term, boundNames) => {
    if (!Array.isArray(term) || term.length === 0) return;
    if (term[0] === "v") {
      if (!boundNames.has(term[1])) into.add(term[1]);
      return;
    }
    if (term[0] === "app") {
      termVars(term[1], boundNames);
      termVars(term[2], boundNames);
      return;
    }
    if (term[0] === "lam") termVars(term[2], boundNames);
    if (term[0] === "lift") {
      for (const arg of term[2] ?? []) termVars(arg, boundNames);
    }
  };
  const walk = (node2, boundNames) => {
    if (!Array.isArray(node2) || node2.length === 0) return;
    if (node2[0] === "eq") {
      termVars(node2[1], boundNames);
      termVars(node2[2], boundNames);
      return;
    }
    if (node2[0] === "and" || node2[0] === "imp" || node2[0] === "iff") {
      walk(node2[1], boundNames);
      walk(node2[2], boundNames);
      return;
    }
    if (node2[0] === "all" || node2[0] === "ex") {
      const next = new Set(boundNames);
      if (Array.isArray(node2[1]) && node2[1][0] === "v") next.add(node2[1][1]);
      walk(node2[2], next);
    }
  };
  walk(formula, bound);
  return into;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
var Z5_UNITS = deepFreeze({
  id: "finite:z5-units",
  label: "\u6A21 5 \u4E58\u6CD5\u5355\u4F4D\u7FA4 Z/5Z^\xD7",
  nodeRef: "group:units5",
  carrier: "G",
  elements: ["1", "2", "3", "4"],
  ops: {
    mul: {
      type: "G -> G -> G",
      // 行 = 左因子，列 = 右因子；表项即 (a×b) mod 5
      table: [
        ["1", "2", "3", "4"],
        ["2", "4", "1", "3"],
        ["3", "1", "4", "2"],
        ["4", "3", "2", "1"]
      ]
    },
    inv: { type: "G -> G", table: ["1", "3", "2", "4"] }
  },
  consts: { e: "1" },
  note: "2 \u7684\u5E42\u4F9D\u6B21\u4E3A 1,2,4,3\uFF0C\u7ED9\u51FA\u56DB\u5143\u5FAA\u73AF\u7FA4\uFF1B\u4EA4\u6362\u6027\u662F\u8BE5\u4F8B\u7684\u5076\u7136\u7279\u5F81\uFF0C\u4E0D\u662F\u7FA4\u516C\u7406\u3002"
});
var S3 = deepFreeze({
  id: "finite:s3",
  label: "S\u2083\uFF08{1,2,3} \u4E0A\u5168\u90E8\u53CC\u5C04\u7684\u5BF9\u79F0\u7FA4\uFF09",
  nodeRef: "group:noncomm",
  carrier: "G",
  elements: ["e", "(12)", "(13)", "(23)", "(123)", "(132)"],
  elementMaps: {
    "e": [1, 2, 3],
    "(12)": [2, 1, 3],
    "(13)": [3, 2, 1],
    "(23)": [1, 3, 2],
    "(123)": [2, 3, 1],
    "(132)": [3, 1, 2]
  },
  ops: {
    mul: {
      type: "G -> G -> G",
      table: [
        ["e", "(12)", "(13)", "(23)", "(123)", "(132)"],
        ["(12)", "e", "(132)", "(123)", "(23)", "(13)"],
        ["(13)", "(123)", "e", "(132)", "(12)", "(23)"],
        ["(23)", "(132)", "(123)", "e", "(13)", "(12)"],
        ["(123)", "(13)", "(23)", "(12)", "(132)", "e"],
        ["(132)", "(23)", "(12)", "(13)", "e", "(123)"]
      ]
    },
    inv: { type: "G -> G", table: ["e", "(12)", "(13)", "(23)", "(132)", "(123)"] }
  },
  consts: { e: "e" },
  note: "\u6309\u300C\u5148\u4F5C\u7528\u53F3\u8FB9\u300D\u7684\u590D\u5408\u7EA6\u5B9A\uFF0C(12)(23)=(123) \u800C (23)(12)=(132)\uFF0C\u6545\u975E\u4EA4\u6362\uFF1B\u516D\u4E2A\u5143\u7D20\u4ECD\u6EE1\u8DB3\u7FA4\u516C\u7406\u3002"
});
var MODELS = /* @__PURE__ */ new Map([
  [Z5_UNITS.id, Z5_UNITS],
  [S3.id, S3]
]);
var REGISTERED_MODELS = Object.freeze([...MODELS.keys()]);
function getModel(id) {
  const model = MODELS.get(id);
  if (!model) {
    throw unsupported(`\u672A\u77E5\u7684\u6709\u9650\u6A21\u578B\uFF1A${String(id)}\uFF08\u672C\u6A21\u5757\u53EA\u8BA4 ${REGISTERED_MODELS.join("\u3001")}\uFF0C\u4E0D\u641C\u7D22\u4EFB\u610F\u6A21\u578B\uFF09`);
  }
  return model;
}
function validateModel(model) {
  const problems = [];
  if (!model || typeof model !== "object") return ["\u6A21\u578B\u5FC5\u987B\u662F\u5BF9\u8C61"];
  if (typeof model.id !== "string" || model.id.length === 0) problems.push("\u7F3A\u5C11\u6A21\u578B id");
  if (typeof model.carrier !== "string" || model.carrier.length === 0) problems.push("\u7F3A\u5C11\u8F7D\u4F53\u7C7B\u578B\u540D carrier");
  const elements = model.elements;
  if (!Array.isArray(elements) || elements.length === 0) {
    problems.push("\u8F7D\u4F53 elements \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
  } else {
    const seen = /* @__PURE__ */ new Set();
    for (const name of elements) {
      if (typeof name !== "string" || name.length === 0) {
        problems.push("\u8F7D\u4F53\u5143\u7D20\u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32");
        break;
      }
      if (seen.has(name)) {
        problems.push(`\u8F7D\u4F53\u5143\u7D20\u91CD\u590D\uFF1A${name}`);
        break;
      }
      seen.add(name);
    }
  }
  const carrierElements = Array.isArray(elements) ? elements : [];
  const size = carrierElements.length;
  const ops = model.ops && typeof model.ops === "object" ? model.ops : {};
  for (const [name, op] of Object.entries(ops)) {
    if (!op || typeof op !== "object") {
      problems.push(`\u8FD0\u7B97 ${name} \u7F3A\u5C11\u5B9A\u4E49`);
      continue;
    }
    let type;
    try {
      type = normalizeType(op.type);
    } catch (error) {
      problems.push(`\u8FD0\u7B97 ${name} \u7684\u7C7B\u578B\u975E\u6CD5\uFF1A${error.message}`);
      continue;
    }
    const arity = arrowArity(type);
    if (arity < 1 || arity > 2) {
      problems.push(`\u8FD0\u7B97 ${name} \u7684\u8868\u683C\u5F0F\u53EA\u652F\u6301\u4E00\u5143\u4E0E\u4E8C\u5143\uFF08\u73B0\u5728\u662F ${arity} \u5143\uFF09`);
      continue;
    }
    if ([...typeInputs(type), typeCodomain(type)].some((part) => !typeEquals2(part, model.carrier))) {
      problems.push(`\u8FD0\u7B97 ${name} \u7684\u7C7B\u578B ${typeToText(type)} \u4E0D\u662F\u5355\u4E00\u8F7D\u4F53 ${model.carrier} \u4E0A\u7684\u8FD0\u7B97`);
      continue;
    }
    const closed = (value) => typeof value === "string" && carrierElements.includes(value);
    if (arity === 1) {
      if (!Array.isArray(op.table) || op.table.length !== size) {
        problems.push(`\u8FD0\u7B97 ${name} \u7684\u9006\u5143\u8868\u957F\u5EA6\u5E94\u4E3A ${size}`);
      } else if (!op.table.every(closed)) {
        problems.push(`\u8FD0\u7B97 ${name} \u7684\u8868\u91CC\u6709\u4E0D\u5728\u8F7D\u4F53\u4E2D\u7684\u53D6\u503C`);
      }
    } else if (!Array.isArray(op.table) || op.table.length !== size) {
      problems.push(`\u8FD0\u7B97 ${name} \u7684\u4E58\u6CD5\u8868\u5E94\u6709 ${size} \u884C`);
    } else if (!op.table.every((row) => Array.isArray(row) && row.length === size)) {
      problems.push(`\u8FD0\u7B97 ${name} \u7684\u4E58\u6CD5\u8868\u6BCF\u884C\u5E94\u6709 ${size} \u683C`);
    } else if (!op.table.every((row) => row.every(closed))) {
      problems.push(`\u8FD0\u7B97 ${name} \u7684\u8868\u91CC\u6709\u4E0D\u5728\u8F7D\u4F53\u4E2D\u7684\u53D6\u503C`);
    }
  }
  const consts = model.consts && typeof model.consts === "object" ? model.consts : {};
  for (const [name, value] of Object.entries(consts)) {
    if (Object.prototype.hasOwnProperty.call(ops, name)) problems.push(`\u5E38\u5143 ${name} \u4E0E\u8FD0\u7B97\u91CD\u540D`);
    if (!carrierElements.includes(value)) problems.push(`\u5E38\u5143 ${name} \u7684\u53D6\u503C ${String(value)} \u4E0D\u5728\u8F7D\u4F53\u4E2D`);
  }
  return problems;
}
function makeContext(model, sig) {
  const problems = validateModel(model);
  if (problems.length > 0) {
    throw bad(`\u6709\u9650\u6A21\u578B\u7ED3\u6784\u975E\u6CD5\uFF08${model?.id ?? "\u672A\u547D\u540D"}\uFF09\uFF1A${problems[0]}`, { model: model?.id ?? null, problems });
  }
  const supplied = sig && typeof sig === "object" ? sig : {};
  const constants = {};
  for (const [name, op] of Object.entries(model.ops ?? {})) constants[name] = normalizeType(op.type);
  for (const name of Object.keys(model.consts ?? {})) constants[name] = model.carrier;
  for (const [name, type] of Object.entries(supplied.constants ?? {})) {
    try {
      constants[name] = normalizeType(type);
    } catch (error) {
      throw bad(`\u7B7E\u540D\u91CC\u5E38\u91CF ${name} \u7684\u7C7B\u578B\u975E\u6CD5\uFF1A${error.message}`);
    }
  }
  const bases = Array.isArray(supplied.bases) && supplied.bases.length > 0 ? supplied.bases.map((entry) => String(entry)) : [model.carrier];
  if (!bases.includes(model.carrier)) {
    throw unsupported(`\u7B7E\u540D\u91CC\u7684\u8F7D\u4F53\u8868\uFF08${bases.join("\u3001")}\uFF09\u4E0D\u542B\u6A21\u578B\u8F7D\u4F53 ${model.carrier}\uFF1A\u672C\u6A21\u5757\u4E0D\u505A\u8DE8\u8F7D\u4F53\u89E3\u91CA`);
  }
  const requested = supplied.maxWitnesses;
  return {
    model,
    constants,
    bases,
    carrier: model.carrier,
    index: new Map(model.elements.map((name, i) => [name, i])),
    opValues: /* @__PURE__ */ new Map(),
    maxWitnesses: Number.isInteger(requested) && requested > 0 ? requested : MAX_WITNESSES
  };
}
function assertDeclaredType(type, ctx, what) {
  for (const atom of typeAtoms(type)) {
    if (!ctx.bases.includes(atom)) {
      throw bad(`${what} \u7684\u7C7B\u578B ${typeToText(type)} \u542B\u672A\u58F0\u660E\u7684\u539F\u5B50\u7C7B\u578B ${atom}`);
    }
  }
}
function needArity(node2, length, what) {
  if (!Array.isArray(node2) || node2.length !== length) {
    throw bad(`${what} \u7684\u5F62\u72B6\u5E94\u4E3A\u957F\u5EA6 ${length} \u7684\u6570\u7EC4\uFF1A${JSON.stringify(node2)}`);
  }
}
function termTypeOf(term, ctx, bound = []) {
  if (!Array.isArray(term) || term.length === 0) throw bad("\u9879\u5FC5\u987B\u662F [\u6807\u7B7E, \u2026] \u5F62\u72B6\u7684\u89C4\u8303\u9879\u6811");
  switch (term[0]) {
    case "v": {
      needArity(term, 3, "\u53D8\u91CF v");
      if (typeof term[1] !== "string" || term[1].length === 0) throw bad("\u53D8\u91CF\u540D\u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32");
      const type = normalizeType(term[2]);
      assertDeclaredType(type, ctx, `\u53D8\u91CF ${term[1]}`);
      return type;
    }
    case "b": {
      needArity(term, 3, "\u7ED1\u5B9A\u53D8\u91CF b");
      const slot = bound[term[1]];
      if (!slot) throw bad(`\u60AC\u7A7A\u7684\u7ED1\u5B9A\u53D8\u91CF #${term[1]}\uFF08\u5F53\u524D\u62BD\u8C61\u6DF1\u5EA6 ${bound.length}\uFF09`);
      if (!typeEquals2(slot, normalizeType(term[2]))) {
        throw bad(`\u7ED1\u5B9A\u53D8\u91CF #${term[1]} \u7684\u7C7B\u578B\u4E0E\u6240\u5728\u62BD\u8C61\u4E0D\u4E00\u81F4\uFF1A${typeToText(term[2])} \u2260 ${typeToText(slot)}`);
      }
      return slot;
    }
    case "c": {
      needArity(term, 2, "\u5E38\u5143 c");
      const type = ctx.constants[term[1]];
      if (!type) throw bad(`\u672A\u58F0\u660E\u7684\u5E38\u91CF\uFF1A${String(term[1])}`, { model: ctx.model.id });
      return type;
    }
    case "app": {
      needArity(term, 3, "\u5E94\u7528 app");
      const fnType = termTypeOf(term[1], ctx, bound);
      if (!isArrow2(fnType)) throw bad(`${describeTerm(term[1])} \u7684\u7C7B\u578B ${typeToText(fnType)} \u4E0D\u662F\u51FD\u6570\uFF0C\u4E0D\u80FD\u5E94\u7528`);
      const argType = termTypeOf(term[2], ctx, bound);
      if (!typeEquals2(fnType[1], argType)) {
        throw bad(`\u5E94\u7528\u7C7B\u578B\u4E0D\u5339\u914D\uFF1A${typeToText(fnType)} \u5E94\u7528\u4E8E ${typeToText(argType)}`);
      }
      return fnType[2];
    }
    case "lam": {
      needArity(term, 3, "\u62BD\u8C61 lam");
      const parameterType = normalizeType(term[1]);
      assertDeclaredType(parameterType, ctx, "\u62BD\u8C61\u7684\u53C2\u6570");
      return [ARROW, parameterType, termTypeOf(term[2], ctx, [parameterType, ...bound])];
    }
    case "lift": {
      needArity(term, 3, "\u62BD\u8C61\u901A\u9053 lift");
      const abstraction = term[1];
      if (!Array.isArray(abstraction) || abstraction[0] !== "lam") {
        throw bad("lift \u7684\u7B2C\u4E00\u4E2A\u6210\u5206\u5FC5\u987B\u662F\u89C4\u8303\u62BD\u8C61 [lam, \u53C2\u6570\u7C7B\u578B, \u4F53]");
      }
      if (!Array.isArray(term[2])) throw bad("lift \u7684\u7B2C\u4E8C\u4E2A\u6210\u5206\u5FC5\u987B\u662F\u5B9E\u53C2\u6570\u7EC4");
      const params = parameters2(abstraction);
      if (params.length !== term[2].length) {
        throw bad(`lift \u7684\u5B9E\u53C2\u4E2A\u6570\uFF08${term[2].length}\uFF09\u4E0E\u62BD\u8C61\u7684\u81EA\u7531\u53D8\u91CF\u4E2A\u6570\uFF08${params.length}\uFF09\u4E0D\u4E00\u81F4`, {
          parameters: params.map((entry) => entry[1])
        });
      }
      term[2].forEach((arg, i) => {
        const want = normalizeType(params[i][2]);
        const got = termTypeOf(arg, ctx, bound);
        if (!typeEquals2(want, got)) {
          throw bad(`lift \u7B2C ${i + 1} \u4E2A\u5B9E\u53C2\u7684\u7C7B\u578B\u4E0D\u5BF9\uFF08\u53C2\u6570 ${params[i][1]} \u8981\u6C42 ${typeToText(want)}\uFF0C\u5B9E\u9645 ${typeToText(got)}\uFF09`);
        }
      });
      return termTypeOf(abstraction, ctx, bound);
    }
    default:
      throw bad(`\u4E0D\u8BA4\u8BC6\u7684\u9879\u5F62\u72B6\uFF1A${String(term[0])}\uFF08\u89C4\u8303\u9879\u53EA\u6709 v / b / c / app / lam / lift\uFF09`);
  }
}
function describeTerm(term) {
  if (!Array.isArray(term) || term.length === 0) return String(term);
  switch (term[0]) {
    case "v":
      return String(term[1]);
    case "b":
      return `#${term[1]}`;
    case "c":
      return String(term[1]);
    case "app": {
      const args = [];
      let head = term;
      while (Array.isArray(head) && head[0] === "app") {
        args.unshift(describeTerm(head[2]));
        head = head[1];
      }
      return `${describeTerm(head)}(${args.join(", ")})`;
    }
    case "lam":
      return `\u03BB#0.${describeTerm(term[2])}`;
    case "lift":
      return `lift(${describeTerm(term[1])})[${(term[2] ?? []).map((arg) => describeTerm(arg)).join(", ")}]`;
    default:
      return JSON.stringify(term);
  }
}
function describeFormula(formula) {
  if (!Array.isArray(formula) || formula.length === 0) return String(formula);
  switch (formula[0]) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "eq":
      return `${describeTerm(formula[1])} = ${describeTerm(formula[2])}`;
    case "and":
      return `(${describeFormula(formula[1])} \u2227 ${describeFormula(formula[2])})`;
    case "imp":
      return `(${describeFormula(formula[1])} \u21D2 ${describeFormula(formula[2])})`;
    case "iff":
      return `(${describeFormula(formula[1])} \u21D4 ${describeFormula(formula[2])})`;
    case "all":
      return `\u2200${formula[1]?.[1]}. ${describeFormula(formula[2])}`;
    case "ex":
      return `\u2203${formula[1]?.[1]}. ${describeFormula(formula[2])}`;
    default:
      return JSON.stringify(formula);
  }
}
function isFunctionValue(value) {
  return Boolean(value) && typeof value === "object" && value.kind === "fun";
}
function elementOf(value, ctx, what) {
  if (typeof value === "string" && ctx.index.has(value)) return ctx.index.get(value);
  throw bad(`\u503C ${String(value)} \u4E0D\u5728\u8F7D\u4F53 ${ctx.carrier} \u4E2D\uFF08${what}\uFF09`, { model: ctx.model.id });
}
function lookupTable(table, idx) {
  return idx.length === 1 ? table[idx[0]] : table[idx[0]][idx[1]];
}
function tableFunction(ctx, name, op) {
  const type = normalizeType(op.type);
  const arity = arrowArity(type);
  const build = (args) => ({
    kind: "fun",
    name,
    type: typeAfterArgs(type, args.length),
    arity: arity - args.length,
    apply: (arg) => {
      const idx = elementOf(arg, ctx, `\u8FD0\u7B97 ${name} \u7684\u7B2C ${args.length + 1} \u4E2A\u5B9E\u53C2`);
      const next = [...args, idx];
      if (next.length < arity) return build(next);
      return lookupTable(op.table, next);
    }
  });
  return build([]);
}
function constantValue(name, ctx) {
  if (!Object.prototype.hasOwnProperty.call(ctx.constants, name)) {
    throw bad(`\u672A\u58F0\u660E\u7684\u5E38\u91CF\uFF1A${name}`, { model: ctx.model.id });
  }
  const type = ctx.constants[name];
  if (isArrow2(type)) {
    const op = (ctx.model.ops ?? {})[name];
    if (!op) {
      throw unsupported(`\u51FD\u6570\u578B\u5E38\u91CF ${name} \u5728\u6709\u9650\u6A21\u578B ${ctx.model.id} \u4E0A\u6CA1\u6709\u8FD0\u7B97\u8868\uFF1A\u672C\u6A21\u5757\u4E0D\u4F1A\u51ED\u7A7A\u6784\u9020\u8FD0\u7B97`);
    }
    let cached = ctx.opValues.get(name);
    if (!cached) {
      cached = tableFunction(ctx, name, op);
      ctx.opValues.set(name, cached);
    }
    return cached;
  }
  if (typeEquals2(type, ctx.carrier)) {
    const model = ctx.model;
    const label = Object.prototype.hasOwnProperty.call(model.consts ?? {}, name) ? model.consts[name] : ctx.index.has(name) ? name : void 0;
    if (label === void 0) {
      throw bad(`\u5E38\u5143 ${name}\uFF08\u7C7B\u578B ${typeToText(type)}\uFF09\u5728\u6709\u9650\u6A21\u578B ${model.id} \u4E0A\u6CA1\u6709\u53D6\u503C`, { model: model.id });
    }
    return label;
  }
  throw unsupported(`\u5E38\u91CF ${name} \u7684\u7C7B\u578B ${typeToText(type)} \u8D85\u51FA\u6709\u9650\u8BED\u4E49\u8FB9\u754C\uFF08\u53EA\u652F\u6301\u8F7D\u4F53 ${ctx.carrier} \u53CA\u5176\u51FD\u6570\u7C7B\u578B\uFF09`);
}
function withFree(free, name, type, value) {
  const next = new Map(free);
  next.set(name, { type: normalizeType(type), value });
  return next;
}
function abstractionValue(abstraction, env, ctx) {
  const parameterType = normalizeType(abstraction[1]);
  const bound = [parameterType, ...env.db.map((slot) => slot.type)];
  const bodyType = termTypeOf(abstraction[2], ctx, bound);
  return {
    kind: "fun",
    name: "\u03BB",
    type: [ARROW, parameterType, bodyType],
    arity: 1,
    apply: (arg) => {
      if (typeEquals2(parameterType, ctx.carrier)) elementOf(arg, ctx, "\u62BD\u8C61\u7684\u5B9E\u53C2");
      else if (!isFunctionValue(arg)) throw bad("\u51FD\u6570\u578B\u53C2\u6570\u7684\u5B9E\u53C2\u5FC5\u987B\u662F\u51FD\u6570\u503C");
      return evalTerm(abstraction[2], { ...env, db: [{ type: parameterType, value: arg }, ...env.db] }, ctx);
    }
  };
}
function evalTerm(term, env, ctx) {
  if (!Array.isArray(term) || term.length === 0) throw bad("\u9879\u5FC5\u987B\u662F [\u6807\u7B7E, \u2026] \u5F62\u72B6\u7684\u89C4\u8303\u9879\u6811");
  switch (term[0]) {
    case "v": {
      const slot = env.free.get(term[1]);
      if (!slot) throw bad(`\u81EA\u7531\u53D8\u91CF\u6CA1\u6709\u8D4B\u503C\uFF1A${term[1]}\uFF08\u6709\u9650\u8BED\u4E49\u53EA\u6C42\u503C\u95ED\u516C\u5F0F\uFF0C\u53D8\u91CF\u5FC5\u987B\u7531\u91CF\u8BCD\u7ED1\u5B9A\uFF09`);
      return slot.value;
    }
    case "b": {
      const slot = env.db[term[1]];
      if (!slot) throw bad(`\u60AC\u7A7A\u7684\u7ED1\u5B9A\u53D8\u91CF #${term[1]}`);
      return slot.value;
    }
    case "c":
      return constantValue(term[1], ctx);
    case "app": {
      const fn = evalTerm(term[1], env, ctx);
      if (!isFunctionValue(fn)) throw bad(`${describeTerm(term[1])} \u4E0D\u662F\u53EF\u5E94\u7528\u7684\u51FD\u6570\u503C`);
      return fn.apply(evalTerm(term[2], env, ctx));
    }
    case "lam":
      return abstractionValue(term, env, ctx);
    case "lift": {
      needArity(term, 3, "\u62BD\u8C61\u901A\u9053 lift");
      const abstraction = term[1];
      if (!Array.isArray(abstraction) || abstraction[0] !== "lam") {
        throw bad("lift \u7684\u7B2C\u4E00\u4E2A\u6210\u5206\u5FC5\u987B\u662F\u89C4\u8303\u62BD\u8C61 [lam, \u53C2\u6570\u7C7B\u578B, \u4F53]");
      }
      if (!Array.isArray(term[2])) throw bad("lift \u7684\u7B2C\u4E8C\u4E2A\u6210\u5206\u5FC5\u987B\u662F\u5B9E\u53C2\u6570\u7EC4");
      const params = parameters2(abstraction);
      if (params.length !== term[2].length) {
        throw bad(`lift \u7684\u5B9E\u53C2\u4E2A\u6570\uFF08${term[2].length}\uFF09\u4E0E\u62BD\u8C61\u7684\u81EA\u7531\u53D8\u91CF\u4E2A\u6570\uFF08${params.length}\uFF09\u4E0D\u4E00\u81F4`);
      }
      const free = new Map(env.free);
      term[2].forEach((arg, i) => {
        free.set(params[i][1], { type: normalizeType(params[i][2]), value: evalTerm(arg, env, ctx) });
      });
      return abstractionValue(abstraction, { ...env, free }, ctx);
    }
    default:
      throw bad(`\u4E0D\u8BA4\u8BC6\u7684\u9879\u5F62\u72B6\uFF1A${String(term[0])}\uFF08\u89C4\u8303\u9879\u53EA\u6709 v / b / c / app / lam / lift\uFF09`);
  }
}
function binderDomain(binder, ctx) {
  if (!Array.isArray(binder) || binder[0] !== "v" || binder.length !== 3) {
    throw bad(`\u91CF\u8BCD\u7ED1\u5B9A\u5FC5\u987B\u662F ['v', \u540D, \u7C7B\u578B]\uFF1A${JSON.stringify(binder)}`);
  }
  const type = normalizeType(binder[2]);
  if (!typeEquals2(type, ctx.carrier)) {
    throw unsupported(
      `\u91CF\u8BCD\u7ED1\u5B9A ${binder[1]} \u7684\u7C7B\u578B ${typeToText(type)} \u4E0D\u662F\u672C\u6A21\u578B\u7684\u8F7D\u4F53 ${ctx.carrier}\uFF1A\u672C\u6A21\u5757\u53EA\u5728\u5355\u4E00\u6709\u9650\u8F7D\u4F53\u4E0A\u5B8C\u6574\u679A\u4E3E`,
      { model: ctx.model.id }
    );
  }
  return ctx.model.elements;
}
function checkFormulaShape(formula, ctx) {
  if (!Array.isArray(formula) || formula.length === 0) throw bad("\u516C\u5F0F\u5FC5\u987B\u662F [\u6807\u7B7E, \u2026] \u5F62\u72B6\u7684\u89C4\u8303\u516C\u5F0F\u6811");
  switch (formula[0]) {
    case "true":
    case "false":
      needArity(formula, 1, formula[0]);
      return;
    case "eq": {
      needArity(formula, 3, "eq");
      const left = termTypeOf(formula[1], ctx, []);
      const right = termTypeOf(formula[2], ctx, []);
      if (!typeEquals2(left, right)) {
        throw bad(`\u7B49\u5F0F\u4E24\u8FB9\u7C7B\u578B\u4E0D\u4E00\u81F4\uFF1A${typeToText(left)} \u4E0E ${typeToText(right)}`);
      }
      return;
    }
    case "and":
    case "imp":
    case "iff":
      needArity(formula, 3, formula[0]);
      checkFormulaShape(formula[1], ctx);
      checkFormulaShape(formula[2], ctx);
      return;
    case "all":
    case "ex":
      needArity(formula, 3, formula[0]);
      binderDomain(formula[1], ctx);
      checkFormulaShape(formula[2], ctx);
      return;
    case "or":
      throw unsupported("\u9996\u7248\u8BED\u8A00\u4E0D\u63A5\u53D7\u6790\u53D6 or\uFF08\u5185\u6838\u6CA1\u6709 or \u89C4\u5219\uFF0C\u89C4\u683C \xA71.3\uFF09");
    case "not":
      throw unsupported("\u9996\u7248\u8BED\u8A00\u4E0D\u63A5\u53D7\u5426\u5B9A not\uFF1A\u89E3\u6790\u671F\u5E94\u5C55\u5F00\u4E3A\u300C\u21D2 false\u300D\uFF08\u89C4\u683C \xA71.3\uFF09");
    case "logic":
      throw unsupported("\u65E7\u8BED\u8A00\u7684 logic \u5E38\u5143\u4E0D\u5728\u6709\u9650\u8BED\u4E49\u8303\u56F4\u5185\uFF1A\u547D\u9898\u578B\uFF08o\uFF09\u53D8\u91CF\u4E0E\u903B\u8F91\u7B26\u53F7\u6CA1\u6709\u6709\u9650\u8F7D\u4F53\u53EF\u679A\u4E3E");
    default:
      throw bad(`\u4E0D\u8BA4\u8BC6\u7684\u516C\u5F0F\u5F62\u72B6\uFF1A${String(formula[0])}`);
  }
}
function tagFailures(failures, wrapper) {
  return failures.map((failure) => ({ ...wrapper, child: failure }));
}
function evalFormulaNode(formula, env, ctx) {
  switch (formula[0]) {
    case "true":
      return { value: true, failures: [] };
    case "false":
      return { value: false, failures: [{ kind: "false" }] };
    case "eq": {
      const left = evalTerm(formula[1], env, ctx);
      const right = evalTerm(formula[2], env, ctx);
      if (left === right) return { value: true, failures: [] };
      return {
        value: false,
        failures: [{
          kind: "eq",
          left,
          right,
          leftText: describeTerm(formula[1]),
          rightText: describeTerm(formula[2])
        }]
      };
    }
    case "and": {
      const left = evalFormulaNode(formula[1], env, ctx);
      if (!left.value) return { value: false, failures: tagFailures(left.failures, { kind: "and", side: "left" }) };
      const right = evalFormulaNode(formula[2], env, ctx);
      if (!right.value) return { value: false, failures: tagFailures(right.failures, { kind: "and", side: "right" }) };
      return { value: true, failures: [] };
    }
    case "imp": {
      const left = evalFormulaNode(formula[1], env, ctx);
      if (!left.value) return { value: true, failures: [] };
      const right = evalFormulaNode(formula[2], env, ctx);
      if (!right.value) return { value: false, failures: tagFailures(right.failures, { kind: "imp" }) };
      return { value: true, failures: [] };
    }
    case "iff": {
      const left = evalFormulaNode(formula[1], env, ctx);
      const right = evalFormulaNode(formula[2], env, ctx);
      if (left.value === right.value) return { value: true, failures: [] };
      const failing = left.value ? right : left;
      const side = left.value ? "forward" : "backward";
      return { value: false, failures: tagFailures(failing.failures, { kind: "iff", side }) };
    }
    case "all": {
      const binder = formula[1];
      const domain = binderDomain(binder, ctx);
      const failures = [];
      for (const value of domain) {
        const child = evalFormulaNode(formula[2], { ...env, free: withFree(env.free, binder[1], binder[2], value) }, ctx);
        if (!child.value) {
          for (const failure of child.failures) {
            failures.push({ kind: "all", binder: binder[1], type: normalizeType(binder[2]), value, child: failure });
            if (failures.length >= ctx.maxWitnesses) break;
          }
          if (failures.length >= ctx.maxWitnesses) break;
        }
      }
      return { value: failures.length === 0, failures };
    }
    case "ex": {
      const binder = formula[1];
      const domain = binderDomain(binder, ctx);
      for (const value of domain) {
        const child = evalFormulaNode(formula[2], { ...env, free: withFree(env.free, binder[1], binder[2], value) }, ctx);
        if (child.value) return { value: true, failures: [] };
      }
      return {
        value: false,
        failures: [{
          kind: "ex",
          binder: binder[1],
          type: normalizeType(binder[2]),
          count: domain.length,
          tried: domain.slice(0, 8)
        }]
      };
    }
    default:
      throw bad(`\u4E0D\u8BA4\u8BC6\u7684\u516C\u5F0F\u5F62\u72B6\uFF1A${String(formula[0])}`);
  }
}
function summarizeWitness(witness) {
  if (!witness) return null;
  const assignment = {};
  const path = [];
  let equation = null;
  let node2 = witness;
  while (node2) {
    switch (node2.kind) {
      case "all":
        assignment[node2.binder] = node2.value;
        path.push(`\u2200${node2.binder} = ${node2.value}`);
        node2 = node2.child;
        break;
      case "and":
        path.push(node2.side === "left" ? "\u5DE6\u5408\u53D6\u652F\u4E0D\u6210\u7ACB" : "\u53F3\u5408\u53D6\u652F\u4E0D\u6210\u7ACB");
        node2 = node2.child;
        break;
      case "imp":
        path.push("\u524D\u63D0\u6210\u7ACB\u800C\u7ED3\u8BBA\u4E0D\u6210\u7ACB");
        node2 = node2.child;
        break;
      case "iff":
        path.push(node2.side === "forward" ? "a\u21D2b \u65B9\u5411\u4E0D\u6210\u7ACB" : "b\u21D2a \u65B9\u5411\u4E0D\u6210\u7ACB");
        node2 = node2.child;
        break;
      case "eq":
        equation = {
          left: node2.left,
          right: node2.right,
          leftText: node2.leftText,
          rightText: node2.rightText,
          text: `${node2.leftText} = ${node2.left}\uFF0C\u800C ${node2.rightText} = ${node2.right}\uFF0C\u4E24\u8005\u4E0D\u7B49`
        };
        path.push(`${node2.leftText} = ${node2.left}\uFF0C${node2.rightText} = ${node2.right}\uFF0C\u4E24\u8005\u4E0D\u7B49`);
        node2 = null;
        break;
      case "ex":
        path.push(`\u2203${node2.binder}\uFF1A\u8F7D\u4F53\u91CC ${node2.count} \u4E2A\u5143\u7D20\u9010\u4E2A\u8BD5\u8FC7\uFF0C\u90FD\u4E0D\u6210\u7ACB`);
        node2 = null;
        break;
      case "false":
        path.push("false \u4E0D\u6210\u7ACB");
        node2 = null;
        break;
      default:
        path.push(String(node2.kind));
        node2 = null;
    }
  }
  return { assignment, equation, path };
}
var emptyEnv = () => ({ free: /* @__PURE__ */ new Map(), db: [] });
function assertClosedFormula(formula, what) {
  const free = [...formulaFreeVars(formula)];
  if (free.length > 0) {
    throw bad(`${what}\u542B\u672A\u7ED1\u5B9A\u7684\u81EA\u7531\u53D8\u91CF\uFF1A${free.join("\u3001")}\uFF08\u6709\u9650\u8BED\u4E49\u53EA\u6C42\u503C\u95ED\u516C\u5F0F\uFF09`);
  }
}
function evaluateFormulaWithWitness(formula, model, sig) {
  const resolved = typeof model === "string" ? getModel(model) : model;
  const ctx = makeContext(resolved, sig);
  checkFormulaShape(formula, ctx);
  assertClosedFormula(formula, "\u5F85\u6C42\u503C\u7684\u516C\u5F0F");
  const { value, failures } = evalFormulaNode(formula, emptyEnv(), ctx);
  const witness = value ? null : failures[0] ?? null;
  return {
    value,
    witness,
    witnessSummary: summarizeWitness(witness),
    model: ctx.model.id,
    formula: describeFormula(formula),
    scope: value ? scopeText(FINITE_SEMANTICS_SCOPE, FINITE_RESULT_SCOPE) : scopeText(FINITE_SEMANTICS_SCOPE, FINITE_COUNTEREXAMPLE_SCOPE),
    boundary: [FINITE_RESULT_SCOPE, INFINITE_STRUCTURE_BOUNDARY, FINITE_COUNTEREXAMPLE_SCOPE]
  };
}
var vNode = (name, type) => ["v", name, type];
var cNode = (name) => ["c", name];
var app = (fn, arg) => ["app", fn, arg];
var app2 = (fn, a, b) => app(app(fn, a), b);
var eq = (left, right) => ["eq", left, right];
var and = (left, right) => ["and", left, right];
var all = (binder, body) => ["all", binder, body];
var GA = vNode("a", "G");
var GB = vNode("b", "G");
var GC = vNode("c", "G");
var GROUP_AXIOMS = deepFreeze({
  id: "group-axioms",
  label: "\u7FA4\u516C\u7406\uFF08\u7ED3\u5408\u3001\u5355\u4F4D\u3001\u9006\uFF1B\u4E0D\u542B\u4EA4\u6362\u5F8B\uFF09",
  nodeRef: "group:group-concept",
  axioms: [
    {
      id: "associative",
      label: "\u7ED3\u5408\u5F8B",
      source: "\u2200a b c. (a\xB7b)\xB7c = a\xB7(b\xB7c)",
      formula: all(GA, all(GB, all(GC, eq(
        app2(cNode("mul"), app2(cNode("mul"), GA, GB), GC),
        app2(cNode("mul"), GA, app2(cNode("mul"), GB, GC))
      ))))
    },
    {
      id: "identity",
      label: "\u5355\u4F4D\u5143\uFF08\u5DE6\u4E0E\u53F3\uFF09",
      source: "\u2200a. e\xB7a = a \u2227 a\xB7e = a",
      formula: all(GA, and(
        eq(app2(cNode("mul"), cNode("e"), GA), GA),
        eq(app2(cNode("mul"), GA, cNode("e")), GA)
      ))
    },
    {
      id: "inverse",
      label: "\u9006\u5143\uFF08\u5DE6\u4E0E\u53F3\uFF09",
      source: "\u2200a. a\u207B\xB9\xB7a = e \u2227 a\xB7a\u207B\xB9 = e",
      formula: all(GA, and(
        eq(app2(cNode("mul"), app(cNode("inv"), GA), GA), cNode("e")),
        eq(app2(cNode("mul"), GA, app(cNode("inv"), GA)), cNode("e"))
      ))
    }
  ]
});
var COMMUTATIVE_LAW = deepFreeze({
  id: "commutative-law",
  label: "\u4EA4\u6362\u5F8B\uFF08\u67D0\u4E9B\u7FA4\u7684\u5076\u7136\u7279\u5F81\uFF0C\u4E0D\u662F\u7FA4\u516C\u7406\uFF09",
  nodeRef: "group:pattern-all-commutative",
  axioms: [
    {
      id: "commutative",
      label: "\u4EA4\u6362\u5F8B",
      source: "\u2200a b. a\xB7b = b\xB7a",
      formula: all(GA, all(GB, eq(app2(cNode("mul"), GA, GB), app2(cNode("mul"), GB, GA))))
    }
  ]
});

// src/witness.mjs
var need2 = (ok, message) => {
  if (!ok) throw new Error(message);
};
var own = (o, k) => Object.hasOwn(o, k);
function signature(declarations) {
  const constants = Object.fromEntries(Object.entries(declarations).map(([n, t]) => [n, parseType(t)]));
  const bases = /* @__PURE__ */ new Set(["o"]);
  const visit = (t) => Array.isArray(t) ? t.slice(1).forEach(visit) : bases.add(t);
  Object.values(constants).forEach(visit);
  return { bases: [...bases].sort(), constants };
}
function symbols(tree, out = /* @__PURE__ */ new Set()) {
  if (Array.isArray(tree)) {
    if (tree[0] === "c") out.add(tree[1]);
    else tree.forEach((x) => symbols(x, out));
  }
  return out;
}
function acyclic(edges, message) {
  const done = /* @__PURE__ */ new Set(), active = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (done.has(id)) return;
    need2(!active.has(id), `${message}\uFF1A${[...active, id].join(" \u2192 ")}`);
    active.add(id);
    for (const to of edges.get(id) ?? []) visit(to);
    active.delete(id);
    done.add(id);
  };
  for (const id of edges.keys()) visit(id);
}
function prepareReferences(r, context) {
  const sources = context.formalSources ?? {}, versions = context.versions ?? {};
  const declarations = { ...r.formal.declarations }, providers = /* @__PURE__ */ new Map(), raw = [];
  for (const [node2, s] of Object.entries(sources)) {
    need2(versions[node2] === s.version, `\u5B9A\u4E49\u6765\u6E90 ${node2} \u7684\u8282\u70B9\u7248\u672C\u5DF2\u8FC7\u671F`);
    for (const [name, type] of Object.entries(s.declarations)) {
      if (own(declarations, name)) need2(typeEquals(parseType(declarations[name]), parseType(type)), `\u80CC\u666F\u7B26\u53F7 ${name} \u7C7B\u578B\u51B2\u7A81`);
      declarations[name] = type;
    }
    for (const d of s.definitions) {
      need2(!providers.has(d.name), `\u5B9A\u4E49\u7B26\u53F7 ${d.name} \u6765\u6E90\u6B67\u4E49`);
      providers.set(d.name, { node: node2, version: s.version });
      raw.push(d);
    }
  }
  for (const d of raw) need2(!own(declarations, d.name), `\u5B9A\u4E49\u7B26\u53F7 ${d.name} \u88AB\u5C40\u90E8\u58F0\u660E\u906E\u853D\uFF1B\u5C40\u90E8\u53C2\u6570\u4E0D\u6784\u6210\u5B9A\u4E49\u6765\u6E90`);
  const base = signature(declarations), full = signature({ ...declarations, ...Object.fromEntries(raw.map((d) => [d.name, d.type])) });
  const parsed = /* @__PURE__ */ new Map(), deps = /* @__PURE__ */ new Map(), nodeEdges = /* @__PURE__ */ new Map();
  for (const d of raw) {
    const owner = sources[providers.get(d.name).node];
    const sourceSig = signature({ ...owner.declarations, ...Object.fromEntries(raw.map((x) => [x.name, x.type])) });
    const term = parseTerm(d.source, { ...sourceSig, expected: parseType(d.type) });
    need2(!Object.keys(objectFv(term)).length, `\u5B9A\u4E49 ${d.name} \u5FC5\u987B\u662F\u65E7\u8BED\u8A00\u95ED\u9879`);
    parsed.set(d.name, term);
    const uses = [...symbols(term)].filter((n) => providers.has(n));
    deps.set(d.name, uses);
    for (const n of uses) {
      const a = providers.get(d.name).node, b = providers.get(n).node;
      if (a !== b) nodeEdges.set(a, [...nodeEdges.get(a) ?? [], b]);
    }
  }
  acyclic(deps, "\u5B9A\u4E49\u7B26\u53F7\u5FAA\u73AF");
  const ordered = [], done = /* @__PURE__ */ new Set();
  const order = (n) => {
    if (done.has(n)) return;
    for (const d of deps.get(n) ?? []) order(d);
    done.add(n);
    ordered.push({ name: n, kind: "term", type: full.constants[n], term: parsed.get(n) });
  };
  raw.forEach((d) => order(d.name));
  const parts = kernelTheory({ id: "mcs-local-definitions/1", ...base, definitions: ordered });
  const ctx = parts.sig;
  const premises = r.formal.premises.map((p) => parseFormula(p, ctx)), goal = parseFormula(r.formal.goal, ctx);
  const refs = r.formal.witness?.references;
  need2(r.formal.witness?.mode === "reference" && refs?.length, "\u5B9A\u4E49\u5F15\u7528\u9700\u8981\u660E\u786E\u6765\u6E90\u7B26\u53F7");
  const used = symbols(goal), seen = /* @__PURE__ */ new Set(), nodes = /* @__PURE__ */ new Set();
  for (const ref of refs) {
    need2(!seen.has(ref.symbol), `\u91CD\u590D\u5F15\u7528 ${ref.symbol}`);
    seen.add(ref.symbol);
    const p = providers.get(ref.symbol);
    need2(p && p.node === ref.node && p.version === ref.version && r.nodeVersions[ref.node] === ref.version, `\u7B26\u53F7 ${ref.symbol} \u7684\u6765\u6E90\u6216\u7248\u672C\u4E0D\u5339\u914D`);
    need2(ref.node !== r.output && r.inputs.includes(ref.node), "\u5B9A\u4E49\u5F15\u7528\u4E0D\u80FD\u5F15\u7528\u81EA\u8EAB\u6216\u672A\u5217\u51FA\u7684\u8F93\u5165");
    need2(used.has(ref.symbol), `\u8F93\u51FA\u9648\u8FF0\u6CA1\u6709\u5B9E\u9645\u4F7F\u7528 ${ref.symbol}`);
    nodes.add(ref.node);
  }
  for (const n of used) if (providers.has(n)) need2(seen.has(n), `\u8F93\u51FA\u4F7F\u7528\u7684\u5B9A\u4E49\u7B26\u53F7 ${n} \u672A\u6CE8\u660E\u6765\u6E90`);
  need2(r.inputs.every((n) => nodes.has(n)), "\u6BCF\u4E2A\u5B9A\u4E49\u8F93\u5165\u987B\u63D0\u4F9B\u81F3\u5C11\u4E00\u4E2A\u5B9E\u9645\u4F7F\u7528\u7684\u7B26\u53F7");
  for (const rel of [...(context.relations ?? []).filter((x) => x.id !== r.id), r]) if (rel.kind === "definitionReference") {
    for (const ref of rel.formal?.witness?.references ?? []) nodeEdges.set(rel.output, [...nodeEdges.get(rel.output) ?? [], ref.node]);
  }
  acyclic(nodeEdges, "\u5B9A\u4E49\u8282\u70B9\u4F9D\u8D56\u5FAA\u73AF");
  return { status: "witness-candidate", input: relationInput(r, context), payload: { schema: "mcs-witness/1", mode: "reference", theory: parts.theory, symbolTypes: full.constants, premises, goal, references: refs, providers: Object.fromEntries(providers), nodeVersions: r.nodeVersions, versions, nodeEdges: [...nodeEdges] }, expected: { references: refs }, evidence: "DEF", message: "\u5B9A\u4E49\u6765\u6E90\u3001\u7C7B\u578B\u3001\u5B9E\u9645\u7B26\u53F7\u51FA\u73B0\u4E0E\u4F9D\u8D56\u65E0\u73AF\u901A\u8FC7\uFF1B\u6B64\u68C0\u67E5\u4E0D\u8BC1\u660E\u8F93\u51FA\u547D\u9898\u3002" };
}
function prepareInstantiation(r, parts, premises, goal) {
  need2(premises.length === 1, "\u5168\u79F0\u4EE3\u5165\u9700\u8981\u6070\u597D\u4E00\u4E2A\u6A21\u5F0F\u8F93\u5165");
  const terms = r.formal.witness.terms;
  need2(terms.length > 0 && terms.length <= 16, "\u987B\u63D0\u4F9B 1\u201316 \u4E2A\u4EE3\u5165\u9879");
  let result = premises[0];
  const parsed = [];
  for (const source of terms) {
    need2(result[0] === "all", "\u4EE3\u5165\u9879\u8D85\u8FC7\u6700\u5916\u5C42\u5168\u79F0\u91CF\u8BCD\u7684\u6570\u91CF");
    const objectTerm = parseTerm(source, { ...parts.sig, expected: result[1][2] });
    need2(!Object.keys(objectFv(objectTerm)).length, "\u4EE3\u5165\u9879\u987B\u4E3A\u58F0\u660E\u8BED\u5883\u4E2D\u7684\u95ED\u9879\uFF1B\u4E0D\u63A5\u53D7\u9690\u85CF\u81EA\u7531\u53D8\u91CF");
    const term = lift(objectTerm, parts.sig);
    parsed.push(term);
    result = fsub(result[2], result[1], term);
  }
  need2(sameFormula(result, goal), "\u4EE3\u5165\u7ED3\u679C\u4E0E\u8F93\u51FA\u9648\u8FF0\u4E0D\u4E00\u81F4\uFF08\u5305\u62EC\u672A\u6D88\u53BB\u7684\u91CF\u8BCD\uFF09");
  let proof = { rule: "hypothesis", goal: premises[0], premises: [], hypothesis: { name: "pattern", id: "pattern" } };
  let formula = premises[0];
  for (const term of parsed) {
    formula = fsub(formula[2], formula[1], term);
    proof = { rule: "all_e", goal: formula, term, premises: [proof] };
  }
  return { rule: "imp_i", goal: ["imp", premises[0], goal], discharge: "pattern", premises: [proof] };
}
function finiteShape(f, sig, carrier, elements) {
  let nodes = 0, maxDepth = 0;
  const term = (t) => {
    need2(["c", "v", "app"].includes(t[0]), "\u6709\u9650\u68C0\u67E5\u4EC5\u652F\u6301\u4E00\u9636\u9879\uFF1B\u03BB\u3001\u9AD8\u9636\u51FD\u6570\u4E0E\u547D\u9898\u8F7D\u4F53\u5C1A\u4E0D\u652F\u6301");
    if (t[0] === "app") {
      term(t[1]);
      term(t[2]);
    }
  };
  const formula = (x, depth) => {
    nodes++;
    maxDepth = Math.max(maxDepth, depth);
    if (x[0] === "eq") {
      term(x[1]);
      term(x[2]);
      need2(inferTerm(x[1], sig) === carrier && inferTerm(x[2], sig) === carrier, "\u6709\u9650\u7B49\u5F0F\u4EC5\u6BD4\u8F83\u8F7D\u4F53\u5143\u7D20");
    } else if (["and", "imp"].includes(x[0])) {
      formula(x[1], depth);
      formula(x[2], depth);
    } else if (["all", "ex"].includes(x[0])) {
      need2(x[1][2] === carrier, "\u6709\u9650\u91CF\u8BCD\u53EA\u80FD\u904D\u5386\u6307\u5B9A\u8F7D\u4F53");
      formula(x[2], depth + 1);
    } else need2(["true", "false"].includes(x[0]), "\u6709\u9650\u68C0\u67E5\u4E0D\u652F\u6301\u6B64\u516C\u5F0F");
  };
  need2(!Object.keys(formulaFv(f)).length, "\u6709\u9650\u68C0\u67E5\u4E0D\u63A5\u53D7\u672A\u7ED1\u5B9A\u53D8\u91CF");
  formula(f, 0);
  need2(nodes * Math.pow(elements, maxDepth) <= 1e5, "\u5B8C\u6574\u679A\u4E3E\u8D85\u51FA\u6709\u9650\u68C0\u67E5\u9884\u7B97\uFF1B\u8BF7\u7F29\u5C0F\u8F7D\u4F53\u6216\u91CF\u8BCD\u6DF1\u5EA6");
}
function prepareFinite(r, parts, premises, goal, context) {
  const model = r.formal.witness.model, problems = validateModel(model);
  need2(!problems.length, problems.join("\uFF1B"));
  need2(model.elements.length <= 8 && Object.keys(parts.sig.constants).length <= 32, "\u6709\u9650\u68C0\u67E5\u9650 1\u20138 \u5143\u7D20\u3001\u6700\u591A 32 \u4E2A\u7B26\u53F7");
  need2(model.carrier !== "o", "\u4E0D\u80FD\u628A\u547D\u9898\u6216\u771F\u503C\u4F5C\u4E3A\u8FD9\u91CC\u7684\u6570\u5B66\u8F7D\u4F53");
  const entries = { ...Object.fromEntries(Object.entries(model.ops).map(([n, o]) => [n, parseType(o.type)])), ...Object.fromEntries(Object.keys(model.consts).map((n) => [n, model.carrier])) };
  need2(Object.keys(entries).length === Object.keys(parts.sig.constants).length && Object.keys(entries).every((n) => own(parts.sig.constants, n)), "\u6A21\u578B\u7B26\u53F7\u987B\u4E0E\u58F0\u660E\u4E00\u4E00\u5BF9\u5E94\uFF1B\u6BCF\u4E2A\u7B26\u53F7\u90FD\u9700\u5B8C\u6574\u89E3\u91CA");
  for (const [n, t] of Object.entries(parts.sig.constants)) need2(own(entries, n) && typeEquals(t, entries[n]), `\u6A21\u578B\u7B26\u53F7 ${n} \u7684\u7C7B\u578B\u6216\u89E3\u91CA\u4E0D\u5339\u914D`);
  [...premises, goal].forEach((f) => finiteShape(f, parts.sig, model.carrier, model.elements.length));
  const values = premises.map((f) => evaluateFormulaWithWitness(f, model, parts.sig));
  const result = evaluateFormulaWithWitness(goal, model, parts.sig);
  const expected = { premises: values.map((v) => v.value), goal: result.value };
  const canonicalModel = { ...model, ops: Object.fromEntries(Object.entries(model.ops).map(([n, o]) => [n, { ...o, type: parseType(o.type) }])) };
  return {
    status: "witness-candidate",
    input: relationInput(r, context),
    payload: { schema: "mcs-witness/1", mode: "finite", kind: r.kind, sig: parts.sig, model: canonicalModel, premises, goal },
    expected,
    evidence: "FINITE",
    witness: result.witnessSummary,
    message: r.kind === "counterexampleTo" ? "\u6709\u9650\u53CD\u6A21\u578B\u91CD\u653E\u901A\u8FC7\uFF1A\u5168\u90E8\u5047\u8BBE\u4E3A\u771F\uFF0C\u7ED3\u8BBA\u4E3A\u5047\u3002\u53EA\u53CD\u9A73\u6B64\u7CBE\u786E\u8868\u8FBE\u3002" : "\u6709\u9650\u5B9E\u4F8B\u91CD\u653E\u901A\u8FC7\uFF1A\u5168\u90E8\u8F93\u5165\u4E0E\u7ED3\u8BBA\u5728\u6B64\u8F7D\u4F53\u4E0A\u4E3A\u771F\u3002\u672A\u63A8\u5E7F\u5230\u5176\u4ED6\u5BF9\u8C61\u3002"
  };
}
function verifyWitness(prepared, report) {
  need2(report.payloadHash === digest(prepared.payload), "\u72EC\u7ACB\u68C0\u67E5\u8F93\u5165\u6458\u8981\u4E0D\u5339\u914D");
  if (report.status !== "passed") return { status: report.status, input: prepared.input, message: report.message };
  need2(digest(report.result) === digest(prepared.expected), "\u72EC\u7ACB\u68C0\u67E5\u7ED3\u679C\u4E0E\u672C\u673A\u6C42\u503C\u4E0D\u4E00\u81F4");
  return { status: "passed", input: prepared.input, message: prepared.message, evidence: prepared.evidence, scope: prepared.payload.mode === "reference" ? "\u6765\u6E90\u767B\u8BB0\u4E0E\u65E0\u73AF\u68C0\u67E5" : "\u7ED9\u5B9A\u6709\u9650\u8F7D\u4F53\u4E0E\u5B8C\u6574\u8868", witness: prepared.witness, result: report.result, checker: report.checker, checkerSha256: report.checkerSha256, payloadHash: report.payloadHash, checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
}

// src/formal.mjs
function prepareRelation(relation, context = {}) {
  if (!relation.formal) return { status: "unsupported", message: "\u6CA1\u6709\u673A\u5668\u8868\u8FBE\uFF1B\u81EA\u7136\u8BED\u8A00\u89E3\u91CA\u4E0D\u80FD\u81EA\u52A8\u4F5C\u4E3A\u8BC1\u660E\u3002" };
  if (relation.kind === "definitionReference") return prepareReferences(relation, context);
  const { declarations, premises, goal } = relation.formal;
  const constants = Object.fromEntries(Object.entries(declarations).map(([name, type]) => [name, parseType(type)]));
  const bases = /* @__PURE__ */ new Set(["o"]);
  const visit = (t) => Array.isArray(t) ? t.slice(1).forEach(visit) : bases.add(t);
  Object.values(constants).forEach(visit);
  const parts = kernelTheory({ id: "mcs-user-signature/1", bases: [...bases].sort(), constants });
  const ctx = { bases: [...bases], constants };
  const ps = premises.map((p) => parseFormula(p, ctx));
  const g = parseFormula(goal, ctx);
  if (relation.kind === "instanceOf" && relation.formal.witness?.mode === "instantiate") {
    const query = prepareInstantiation(relation, parts, ps, g);
    return { status: "parsed", target: query.goal, query, parts, input: relationInput(relation, context) };
  }
  if (["instanceOf", "counterexampleTo"].includes(relation.kind) && relation.formal.witness?.mode === "finite") return prepareFinite(relation, parts, ps, g, context);
  if (!["conditionalDerivation", "equivalentTo", "scaling"].includes(relation.kind)) return { status: "unsupported", message: "\u8BED\u6CD5\u4E0E\u7C7B\u578B\u5DF2\u901A\u8FC7\uFF1B\u8BF7\u63D0\u4F9B\u6B64\u5173\u7CFB\u4E13\u7528\u7684\u4EE3\u5165\u6216\u6709\u9650\u6A21\u578B\u89C1\u8BC1\u3002" };
  if (relation.kind === "equivalentTo" && ps.length !== 1) throw new Error("\u7B49\u4EF7\u5173\u7CFB\u9700\u8981\u6070\u597D\u4E00\u4E2A\u8F93\u5165\u9648\u8FF0\uFF1B\u8054\u5408\u524D\u63D0\u8BF7\u4F7F\u7528\u6761\u4EF6\u63A8\u5BFC\u3002");
  if (relation.kind === "scaling" && ps.length !== 1) throw new Error("\u653E\u7F29\u68C0\u67E5\u9700\u8981\u4E00\u4E2A\u7279\u6B8A\u7AEF\u9648\u8FF0\uFF0C\u7ED3\u8BBA\u586B\u5199\u4E00\u822C\u7AEF\u9648\u8FF0\u3002");
  const target = relation.kind === "equivalentTo" ? ["and", ["imp", ps[0], g], ["imp", g, ps[0]]] : ps.reduceRight((body, p) => ["imp", p, body], g);
  return { status: "parsed", target, parts, input: relationInput(relation) };
}
function proveRelation(relation, context = {}) {
  const prepared = prepareRelation(relation, context);
  if (prepared.status !== "parsed") return prepared;
  const { target, parts, input } = prepared;
  const result = prepared.query ? { status: "proved", proof: prepared.query } : search(target, { hypotheses: [], clauses: [] }, { sig: parts.sig, maxMs: 2e3, maxStates: 2e3, maxDepth: 15, maxSteps: 1500 });
  if (result.status !== "proved") return { status: result.status, message: result.reason ?? "\u5728\u58F0\u660E\u8303\u56F4\u5185\u672A\u5F97\u5230\u8BC1\u4E66", input };
  const proof = assembleProof(result.proof, { sig: parts.sig, hypotheses: collectHypotheses(result.proof), theoryAxioms: [], definitions: parts.definitions, lemmas: [], rootConclusion: target });
  const bundle = assembleBundle({ theory: parts.theory, proof });
  return { status: "candidate", bundle, target, input, theoryHash: digest(parts.theory) };
}
function verifyReplay(prepared, report) {
  if (report.status !== "passed") return { status: report.status, message: report.message ?? "\u68C0\u67E5\u5668\u6CA1\u6709\u901A\u8FC7", input: prepared.input };
  if (!sameFormula(report.conclusion, prepared.target)) throw new Error("\u68C0\u67E5\u5668\u7ED3\u8BBA\u4E0E\u72EC\u7ACB\u76EE\u6807\u4E0D\u4E00\u81F4");
  if (report.theory_sha256 !== prepared.theoryHash) throw new Error("\u80CC\u666F\u7406\u8BBA\u6458\u8981\u4E0D\u5339\u914D");
  if (Object.keys(report.open_hypotheses ?? {}).length) throw new Error("\u8BC1\u4E66\u7559\u4E0B\u4E86\u672A\u58F0\u660E\u7684\u5F00\u653E\u5047\u8BBE");
  if (prepared.bundle.theory.axioms.length) throw new Error("\u672C\u7F16\u8F91\u5668\u4E0D\u63A5\u53D7\u989D\u5916\u516C\u7406");
  return {
    status: "passed",
    input: prepared.input,
    message: "ND \u5B50\u96C6\u8BC1\u4E66\u901A\u8FC7\uFF1B\u68C0\u67E5\u5668\u81EA\u8EAB\u672A\u7ECF\u5F62\u5F0F\u5316\u9A8C\u8BC1\uFF0C\u6559\u6750\u4E0E\u8282\u70B9\u5BF9\u5E94\u987B\u5355\u72EC\u5BA1\u9605\u3002",
    target: prepared.target,
    checker: report.checker,
    checkerSha256: report.checker_sha256,
    theoryHash: prepared.theoryHash,
    inputHash: digest(prepared.bundle),
    checkedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/worker.mjs
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
var import_node_child_process = require("node:child_process");
var request = JSON.parse(process.argv[2]);
async function main() {
  const { relation, context = {}, kernel, python = "python" } = request;
  if (context.versions && [...relation.inputs, relation.output].some((id) => context.versions[id] !== relation.nodeVersions[id])) return { status: "unsupported", message: "\u5173\u7CFB\u8BB0\u5F55\u7684\u8282\u70B9\u7248\u672C\u5DF2\u8FC7\u671F" };
  const prepared = proveRelation(relation, context);
  if (!["candidate", "witness-candidate"].includes(prepared.status)) return prepared;
  const work = await (0, import_promises.mkdtemp)((0, import_node_path.join)((0, import_node_os.tmpdir)(), "mcs-obsidian-check-"));
  try {
    const file = (0, import_node_path.join)(work, "certificate.json");
    const special = prepared.status === "witness-candidate";
    await (0, import_promises.writeFile)(file, JSON.stringify(special ? prepared.payload : prepared.bundle));
    const checker = special ? (0, import_node_path.join)(kernel, "..", "witness.py") : kernel;
    const report = await new Promise((resolve, reject) => (0, import_node_child_process.execFile)(python, [checker, file], { windowsHide: true, timeout: 8e3, maxBuffer: 4e6 }, (error, stdout) => {
      if (error?.code === "ENOENT") return reject(new Error("\u672A\u627E\u5230 Python\uFF1B\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u586B\u5199\u89E3\u91CA\u5668\u8DEF\u5F84\u3002"));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(error?.killed ? "\u68C0\u67E5\u5668\u8D85\u65F6" : "\u68C0\u67E5\u5668\u672A\u8FD4\u56DE\u6709\u6548\u62A5\u544A"));
      }
    }));
    return special ? verifyWitness(prepared, report) : verifyReplay(prepared, report);
  } finally {
    await (0, import_promises.rm)(work, { recursive: true, force: true });
  }
}
main().then((result) => process.stdout.write(JSON.stringify({ input: relationInput(request.relation, request.context), ...result }))).catch((error) => {
  process.stdout.write(JSON.stringify({ status: "error", message: error.message, input: relationInput(request.relation, request.context) }));
  process.exitCode = 1;
});
