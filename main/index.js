const amqp = require('amqplib');

const record = require('./record');
const upload = require('./upload');
const clean = require('./clean');

function trap(signal, handler, code) {
  process.on(signal, async () => {
    try {
      await handler();
    } catch (_) {
      process.exit(code);
    }
  });
}

async function main({ AMQP_URI, AMQP_QUEUE }) {
  // Connect to the queue.
  const connection = await amqp.connect(AMQP_URI);
  const channel = await connection.createChannel();

  // Gracefully handle signals and initiate an orderly shutdown.
  // Exit with a signal-specific non-zero code if cleanup fails.
  // https://nodejs.org/api/process.html#process_exit_codes

  const shutdown = async () => {
    await channel.close();
    await connection.close();
  };

  trap('SIGINT',  shutdown, 128 + 2); // eslint-disable-line prettier/prettier
  trap('SIGQUIT', shutdown, 128 + 3);
  trap('SIGTERM', shutdown, 128 + 15);

  // Ensure the queue is created.
  await channel.assertQueue(AMQP_QUEUE, { durable: true });

  // Limit how many messages are processed concurrently
  await channel.prefetch(1);

  // Process each individual message.
  const handle = async (message) => {
    try {
      const payload = JSON.parse(message.content.toString());

      // TODO: assert `duration` is an integer
      // TODO: assert `url` is a valid HTTP(S) URL

      const filepath = await record(payload.url, payload.duration);

      await upload(filepath, ''); // TODO: Specify upload destination, auth…
      await clean(filepath);

      await channel.ack(message);
    } catch (_) {
      // TODO: Log error for observability?
      await channel.nack(message);
    }
  };

  // Start to consume queued messages.
  await channel.consume(AMQP_QUEUE, handle, {});
}

module.exports = main;
