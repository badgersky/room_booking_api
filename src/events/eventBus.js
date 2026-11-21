const { EventEmitter } = require("node:events");

// EventEmitter.emit() is synchronous - a slow or failing listener would hit the code that published the event.
// Every handler is therefore run in the next microtask and its errors (sync and async) are caught and logged,
// so a listener can never change the outcome of the operation that published the event.
function createEventBus() {
  const emitter = new EventEmitter();

  return {
    publish(eventName, payload) {
      emitter.emit(eventName, { name: eventName, occurredAt: new Date().toISOString(), payload });
    },

    subscribe(eventName, handler) {
      emitter.on(eventName, event => {
        Promise.resolve()
          .then(() => handler(event))
          .catch(err => console.error(`[event:${eventName}] handler failed`, err));
      });
    }
  };
}

// Null object - used when nobody passes an event bus (e.g. some tests, STORAGE=memory)
const noopEventBus = { publish() {}, subscribe() {} };

module.exports = { createEventBus, noopEventBus };
