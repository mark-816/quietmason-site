/**
 * ChatWidget — Encapsulated offline FAQ chat widget
 * Usage: new ChatWidget({ target: 'bottom-right', title: 'Support' }).mount();
 */
(function(global){
'use strict';
if(global.__chatWidgetMounted) return;
global.__chatWidgetMounted = true;

var DEFAULTS = {
  faq: {
    "hello hi hey": "Hello. Ask about a project, a price, or how we work.",
    "how much price pricing cost quote budget estimate fee": "Published ranges: single automation $250–1,000 · scraping or enrichment pipeline $700–4,600 · multi-step integration $1,000–3,000 · technical SEO audit from $400 · landing page from $300 · store from $900. A quote is one fixed number for a written scope.",
    "automate automation ai agents pipeline scrape scraping crawl n8n zapier integration api workflow": "We build collection, cleaning, scheduling and alerting: n8n, Make or Zapier where they fit, direct APIs where they do not. Send one sample (a URL or an export) and you get a fixed number.",
    "not ranking ranking technical seo seo issues index search console crawl errors core web vitals": "Technical SEO: crawl and index diagnostics from your own Search Console, canonical and redirect hygiene, internal linking, structured data, Core Web Vitals, measured before and after.",
    "cited by chatgpt mentioned by chatgpt chatgpt ai overviews ai search aeo llm visibility": "AI search visibility: one consistent entity, markup that matches the page, and pages written so an assistant can quote them correctly. We do not promise that a model will recommend you.",
    "accept payment get paid invoice bank transfer paypal wise payoneer deposit milestone": "Half up front, half on handover; milestones above $3,000. You get a USD invoice payable by card or bank transfer, and Wise works too. PayPal only on request, with its fee shown separately on the invoice.",
    "nda non disclosure own the code ip ownership license contract": "Happy to sign an NDA. Code, data and credentials are yours from the first commit, and we keep no license over your work.",
    "timezone time zone response time reply hours": "We work from GMT+8: European hours in full, US Eastern mornings, replies within one business day, in writing.",
    "website maintenance monthly maintenance care plan retainer": "Care plan: Watch at $90 a month for monitoring and a monthly report, or Care at $350 for that plus four hours of changes. Cancel any time with 30 days notice.",
    "website migrate migration faster load faster page speed performance wordpress store": "Stores, landing pages, migrations and speed work, plain HTML and PHP by default, so nothing needs a subscription to stay alive.",
    "backlink buy backlinks guarantee": "We do not sell backlinks, run ads, guarantee rankings or AI mentions, or invent case studies."
  },
  fallback: "I only answer from this site's own pages, so I would rather not guess. Leave your email in the form and a person replies within one business day, or write to hello@quietmason.com.",
  title: "quietmason",
  status: "Replies within one business day",
  placeholder: "Ask about a project, a price, or how we work",
  position: { bottom: 24, right: 24 },
  colors: { primary: "#0e1218", accent: "#2a5bd7", accentHover: "#8cb0ff" },
  initialMessage: "Ask me about scope, price, or how we work.<br>I answer from this site only; anything else goes to a person.",
  aiUrl: (window.QM_CHAT_ENDPOINT || "/api/chat"),
  emailFallback: "hello@quietmason.com"
};

function ChatWidget(opts){
  this.cfg = _extend({}, DEFAULTS, opts || {});
  this._elements = {};
  this._open = false;
  this._aiUrl = this.cfg.aiUrl;
  if(this.cfg.welcome) this.cfg.initialMessage = this.cfg.welcome;
  if(this.cfg.title) this.cfg.widgetTitle = this.cfg.title;
}

ChatWidget.prototype = {
  constructor: ChatWidget,

  mount: function(){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', this._build.bind(this));
    } else {
      this._build();
    }
    return this;
  },

  // ── Build DOM ──────────────────────────────────
  _build: function(){
    this._buildTrigger();
    this._buildPanel();
    this._bindEvents();
  },

  _buildTrigger: function(){
    var c = this.cfg;
    var btn = _el('div', {
      id: 'ai-btn',
      css: {
        position:'fixed', bottom:c.position.bottom+'px', right:c.position.right+'px',
        zIndex:9998,
        background:'#fff',
        borderRadius:'12px',
        display:'flex', alignItems:'center', gap:'10px',
        cursor:'pointer',
        boxShadow:'0 4px 24px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.06)',
        border:'1px solid #e8e8e8',
        color:'#1a1a1a',
        fontFamily:'Inter,sans-serif',
        userSelect:'none',
        transition:'box-shadow .22s,transform .15s',
        padding:'10px 16px 10px 12px'
      }
    });
    btn.innerHTML =
      '<div style="width:40px;height:40px;flex:0 0 40px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#0e1218,#243040);font-size:18px">&#9679;</div>' +
      '<div style="display:flex;flex-direction:column;gap:1px">' +
        '<span style="font-size:13px;font-weight:600;color:#1a1a1a;white-space:nowrap">' + c.title + '</span>' +
        '<span style="font-size:10px;color:#888;white-space:nowrap">' + c.status + '</span>' +
      '</div>';
    document.body.appendChild(btn);
    this._elements.trigger = btn;
  },

  _buildPanel: function(){
    var c = this.cfg;
    var panel = _el('div', {
      id: 'ai-panel',
      css: {
        display:'none', position:'fixed', flexDirection:'column',
        bottom:c.position.bottom+'px', right:c.position.right+'px',
        zIndex:9999, width:384, maxWidth:'calc(100vw - 32px)',
        height:'min(620px, calc(100dvh - 7rem))',
        background:'#fff', borderRadius:16, overflow:'hidden',
        boxShadow:'0 8px 40px rgba(0,0,0,0.15)'
      }
    });

    // Header
    var hdr = _el('div', {
      css: {
        background:'linear-gradient(135deg,'+c.colors.primary+',#13243d)',
        color:'#fff', padding:'14px 16px',
        display:'flex', alignItems:'center', justifyContent:'space-between'
      }
    });
    hdr.innerHTML = '<div style="display:flex;align-items:center;gap:8px">' +
      '<span style="font-size:22px">&#9679;</span>' +
      '<span style="font-weight:700;font-size:14px">'+c.title+'</span>' +
      '<span style="font-size:10px;opacity:.7">'+c.status+'</span></div>' +
      '<span id="ai-close" role="button" title="Minimize the chat" aria-label="Minimize chat" style="font-size:22px;line-height:1;opacity:.8;cursor:pointer">&#8964;</span>';

    // Messages
    var msgs = _el('div', {
      id: 'ai-msgs',
      css: { flex:'1 1 auto', minHeight:60, overflowY:'auto', padding:12, background:'#fafafa' }
    });
    msgs.innerHTML = '<div style="display:flex;gap:6px;align-items:flex-start">' +
      '<span style="font-size:20px;flex-shrink:0">&#9679;</span>' +
      '<div style="background:#fff;padding:10px 14px;border-radius:12px;font-size:12px;line-height:1.7;color:#333;box-shadow:0 1px 4px rgba(0,0,0,0.05)">' +
      c.initialMessage + '</div></div>';

    // Input
    var foot = _el('div', { css: { display:'flex', alignItems:'center', gap:6, padding:'8px 12px', borderTop:'1px solid #eee' } });
    var inp = _el('input', {
      id: 'ai-input', type:'text', placeholder:c.placeholder,
      css: { flex:1, padding:'8px 12px', border:'1.5px solid #e0e0e0', borderRadius:20, fontSize:13, outline:'none', background:'#f5f5f5' }
    });
    var sendBtn = _el('button', {
      css: { flexShrink:0, width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center',
             border:'none', borderRadius:'50%', cursor:'pointer', background:c.colors.accent }
    });
    sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

    foot.appendChild(inp);
    foot.appendChild(sendBtn);
    panel.appendChild(hdr);
    panel.appendChild(msgs);
    panel.appendChild(foot);
    document.body.appendChild(panel);

    this._elements.panel = panel;
    this._elements.msgs = msgs;
    this._elements.input = inp;
    this._elements.sendBtn = sendBtn;
  },

  // ── Events ─────────────────────────────────────
  _bindEvents: function(){
    var self = this;
    this._elements.trigger.addEventListener('click', function(){ self.open(); });
    document.getElementById('ai-close').addEventListener('click', function(){ self.close(); });
    this._elements.sendBtn.addEventListener('click', function(){ self._handleSend(); });
    this._elements.input.addEventListener('keydown', function(e){
      if(e.key === 'Enter') self._handleSend();
    });
  },

  open: function(){
    this._elements.panel.style.display = 'flex';
    this._elements.trigger.style.display = 'none';
    this._open = true;
  },

  close: function(){
    this._elements.panel.style.display = 'none';
    this._elements.trigger.style.display = 'flex';
    this._open = false;
  },

  toggle: function(){
    this._open ? this.close() : this.open();
  },

  // ── Message logic ───────────────────────────────
  _handleSend: function(){
    var msg = this._elements.input.value.trim();
    if(!msg) return;
    this._appendMessage('user', msg);
    this._elements.input.value = '';
    this._showTyping();
    var self = this;
    // Try AI backend first, fallback to FAQ
    this._callAI(msg).then(function(reply){
      self._removeTyping();
      self._appendMessage('bot', reply);
    }).catch(function(){
      // Offline fallback
      setTimeout(function(){
        self._removeTyping();
        self._appendMessage('bot', self._findBestReply(msg));
      }, 400);
    });
  },

  _callAI: function(msg){
    if(!this._aiUrl) return Promise.reject();
    return fetch(this._aiUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: msg})
    }).then(function(r){ return r.json(); }).then(function(d){
      return d.reply || '...';
    });
  },

  _appendMessage: function(role, text){
    var msgs = this._elements.msgs;
    var isUser = role === 'user';
    var html = '<div style="display:flex;gap:6px;' + (isUser ? 'justify-content:flex-end' : '') + ';margin-top:8px">' +
      (!isUser ? '<span style="font-size:18px">&#9679;</span>' : '') +
      '<div style="background:' + (isUser ? '#eef1f5' : '#fff') + ';padding:8px 12px;border-radius:12px;font-size:12px;' +
      'max-width:80%;color:#333' + (!isUser ? ';box-shadow:0 1px 4px rgba(0,0,0,0.05)' : '') + '">' +
      this._escape(text) + '</div></div>';
    msgs.innerHTML += html;
    msgs.scrollTop = msgs.scrollHeight;
  },

  _typingId: null,
  _showTyping: function(){
    var id = 'ai-typing-' + Date.now();
    this._typingId = id;
    var html = '<div id="'+id+'" style="margin-top:8px;display:flex;gap:6px;align-items:flex-start">' +
      '<span style="font-size:18px">&#9679;</span>' +
      '<div style="background:#fff;padding:8px 12px;border-radius:12px;font-size:12px;color:#999">typing...</div></div>';
    this._elements.msgs.innerHTML += html;
    this._elements.msgs.scrollTop = this._elements.msgs.scrollHeight;
  },

  _removeTyping: function(){
    var el = document.getElementById(this._typingId);
    if(el) el.remove();
  },

  _findBestReply: function(msg){
    var q = msg.toLowerCase().trim();
    var faq = this.cfg.faq;
    for(var key in faq){
      if(key === 'default') continue;
      var keywords = key.split(' ');
      var hits = 0;
      for(var k=0; k<keywords.length; k++){
        if(q.includes(keywords[k].trim())) hits++;
      }
      if(hits >= Math.ceil(keywords.length / 2)) return faq[key];
    }
    return this.cfg.fallback;
  },

  _escape: function(text){
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(text));
    return d.innerHTML;
  }
};

// ── Helpers ───────────────────────────────────────
function _el(tag, attrs){
  var el = document.createElement(tag);
  if(attrs.id) el.id = attrs.id;
  if(attrs.type) el.type = attrs.type;
  if(attrs.placeholder) el.placeholder = attrs.placeholder;
  if(attrs.css){
    var parts = [];
    var UNITLESS = {zIndex:1,opacity:1,fontWeight:1,lineHeight:1,flex:1,flexGrow:1,flexShrink:1,order:1,scale:1,zoom:1,tabSize:1};
    for(var k in attrs.css){
      var v = attrs.css[k];
      var unit = (typeof v === 'number' && !UNITLESS[k]) ? 'px' : '';
      parts.push(k.replace(/([A-Z])/g, '-$1').toLowerCase() + ':' + v + unit);
    }
    el.style.cssText = parts.join(';');
  }
  return el;
}

function _extend(target){
  for(var i=1; i<arguments.length; i++){
    var src = arguments[i];
    if(!src) continue;
    for(var key in src){
      if(src.hasOwnProperty(key)) target[key] = src[key];
    }
  }
  return target;
}

// ── Export ─────────────────────────────────────────
global.ChatWidget = ChatWidget;

// Auto-init if data-chat-widget attribute exists on a script tag
var scripts = document.getElementsByTagName('script');
for(var i=0; i<scripts.length; i++){
  if(scripts[i].getAttribute('data-chat-widget') !== null){
    new ChatWidget().mount();
    break;
  }
}
})(window);