const { textField, imageField, enumField, GuardError } = require('./ai-guard.cjs');
const { providerConfig } = require('./provider-boundary.cjs');
const create = { scope: 'video-create', perMinute: 6, perDay: 60, concurrent: 2, maxBodyBytes: 4 * 1024 * 1024 };
const read = { scope: 'video-read', prefix: 'AI_READ_GUARD', paid: false, perMinute: 180, perDay: 10000, concurrent: 8, maxBodyBytes: 4 * 1024 * 1024 };
const policy = { ...create,
  validate(body) {
    providerConfig(body);
    enumField(body, 'action', ['', 'status', 'content']);
    if (body.action === 'status' || body.action === 'content') {
      if (typeof body.tid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.tid)) throw new GuardError(400, 'BAD_INPUT', 'Invalid tid');
    } else {
      imageField(body, 'imageDataUrl', true); textField(body, 'prompt', 2000);
      enumField(body, 'mode', ['', 'smart', 'auto', 'i2v']);
      // Current application always generates one 5-second 832x480 video. No client-selected model.
    }
  },
  select(body) { return body.action === 'status' || body.action === 'content' ? read : create; }
};
module.exports = { policy };
