
const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Allow multiple SSE connections
  }
}

const eventBus = new EventBus();

module.exports = eventBus;
