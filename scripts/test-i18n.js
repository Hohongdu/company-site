const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
    constructor() {
        this.items = new Set();
    }

    toggle(name, force) {
        if (force) {
            this.items.add(name);
        } else {
            this.items.delete(name);
        }
    }
}

class FakeElement {
    constructor(attributes = {}) {
        this.attributes = { ...attributes };
        this.dataset = {};
        this.textContent = '';
        this.innerHTML = '';
        this.classList = new FakeClassList();
        this.eventHandlers = {};
        Object.keys(this.attributes).forEach((attr) => {
            if (attr.startsWith('data-')) {
                const datasetKey = attr
                    .slice(5)
                    .split('-')
                    .map((part, index) =>
                        index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
                    )
                    .join('');
                this.dataset[datasetKey] = this.attributes[attr];
            }
        });
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    getAttribute(name) {
        return this.attributes[name];
    }

    hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }

    addEventListener(type, handler) {
        if (!this.eventHandlers[type]) {
            this.eventHandlers[type] = [];
        }
        this.eventHandlers[type].push(handler);
    }

    click() {
        (this.eventHandlers.click || []).forEach((handler) => handler());
    }
}

class FakeDocument {
    constructor(elements) {
        this.elements = elements;
        this.eventHandlers = {};
        this.readyState = 'loading';
        this.documentElement = new FakeElement({ lang: 'ko' });
    }

    querySelectorAll(selector) {
        const match = selector.match(/^\[(.+)]$/);
        if (!match) return [];
        const attr = match[1];
        return this.elements.filter((el) => el.hasAttribute(attr));
    }

    addEventListener(type, handler) {
        if (!this.eventHandlers[type]) {
            this.eventHandlers[type] = [];
        }
        this.eventHandlers[type].push(handler);
    }

    dispatchEvent(event) {
        (this.eventHandlers[event.type] || []).forEach((handler) => handler());
    }
}

class FakeStorage {
    constructor() {
        this.store = new Map();
    }

    getItem(key) {
        return this.store.get(key) || null;
    }

    setItem(key, value) {
        this.store.set(key, String(value));
    }
}

const elements = [
    new FakeElement({ 'data-lang-switch': 'ko' }),
    new FakeElement({ 'data-lang-switch': 'en' }),
    new FakeElement({ 'data-i18n': '', 'data-i18n-ko': '안녕하세요' }),
    new FakeElement({ 'data-i18n-html': '', 'data-i18n-html-ko': '안녕<br />하세요' }),
    new FakeElement({ 'data-i18n-placeholder': '', 'data-i18n-placeholder-ko': '이름 입력' }),
];

const document = new FakeDocument(elements);
const localStorage = new FakeStorage();
const fetch = () =>
    Promise.resolve({
        json: () => Promise.resolve({ translatedText: 'Hello\nWorld' }),
    });

const context = {
    window: {},
    document,
    localStorage,
    fetch,
    setTimeout,
    clearTimeout,
};

context.window.AUTO_TRANSLATE_ENABLED = true;
context.window.TRANSLATE_API_ENDPOINT = 'https://example.com/translate';

const scriptPath = path.join(__dirname, '..', 'public', 'js', 'i18n.js');
const scriptContents = fs.readFileSync(scriptPath, 'utf-8');

vm.runInNewContext(scriptContents, context);
document.dispatchEvent({ type: 'DOMContentLoaded' });

const enButton = elements[1];
enButton.click();

setTimeout(() => {
    const [textEl, htmlEl, placeholderEl] = elements.slice(2);
    try {
        assert.strictEqual(textEl.textContent, 'Hello\nWorld');
        assert.strictEqual(htmlEl.innerHTML, 'Hello<br />World');
        assert.strictEqual(placeholderEl.getAttribute('placeholder'), 'Hello\nWorld');
        console.log('i18n auto-translation tests passed.');
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}, 0);
