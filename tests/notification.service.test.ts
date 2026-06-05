import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ErrorCode } from '../src/utils/errors';

// FCM client mocks. Declared via vi.hoisted so the (hoisted) vi.mock factory
// can reference them without a temporal-dead-zone error.
const { sendMock, sendEachMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  sendEachMock: vi.fn(),
}));

// Replace the entire Firebase layer: no initializeApp(), no real FCM. This also
// avoids the double-init pitfall (initializeApp is never called in tests).
vi.mock('../src/config/firebase', () => ({
  isFirebaseConfigured: () => true,
  getFirebaseApp: () => ({}),
  getMessaging: () => ({
    send: sendMock,
    sendEachForMulticast: sendEachMock,
  }),
}));

import { sendNotification } from '../src/services/notification.service';

const base = { title: 'Build complete', body: 'Your build finished' };

beforeEach(() => {
  sendMock.mockReset();
  sendEachMock.mockReset();
});

describe('sendNotification', () => {
  it('sends to a single token and returns successCount 1 + messageId (and forwards data)', async () => {
    sendMock.mockResolvedValue('projects/demo/messages/abc');

    const result = await sendNotification({
      ...base,
      data: { type: 'build', id: '42' },
      target: { token: 'device-token-1' },
    });

    expect(result).toEqual({
      kind: 'token',
      successCount: 1,
      messageId: 'projects/demo/messages/abc',
    });
    expect(sendEachMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      token: 'device-token-1',
      notification: { title: base.title, body: base.body },
      data: { type: 'build', id: '42' },
    });
  });

  it('sends a multicast via sendEachForMulticast and reports per-token partial failures', async () => {
    sendEachMock.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, messageId: 'projects/demo/messages/ok' },
        {
          success: false,
          error: {
            code: 'messaging/registration-token-not-registered',
            message: 'token not registered',
          },
        },
      ],
    });

    const result = await sendNotification({
      ...base,
      target: { tokens: ['good-token', 'dead-token'] },
    });

    expect(result).toEqual({
      kind: 'tokens',
      successCount: 1,
      failureCount: 1,
      failedTokens: [{ token: 'dead-token', error: 'messaging/registration-token-not-registered' }],
    });
    // Must use sendEachForMulticast — never the single send() or deprecated sendMulticast.
    expect(sendEachMock).toHaveBeenCalledTimes(1);
    expect(sendEachMock).toHaveBeenCalledWith({
      tokens: ['good-token', 'dead-token'],
      notification: { title: base.title, body: base.body },
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('maps an FCM rejection (invalid token) to a 502 FCM_ERROR exposing only the code', async () => {
    sendMock.mockRejectedValue({
      code: 'messaging/invalid-registration-token',
      message: 'The registration token is not a valid FCM registration token',
    });

    try {
      await sendNotification({ ...base, target: { token: 'bogus' } });
      expect.unreachable('sendNotification should have thrown an AppError');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe(ErrorCode.FCM_ERROR);
      expect(appErr.statusCode).toBe(502);
      expect(appErr.message).toContain('messaging/invalid-registration-token');
      expect(appErr.details).toEqual([{ message: 'messaging/invalid-registration-token' }]);
      // The raw FCM message must NOT be surfaced to the caller (sanitised).
      expect(appErr.message).not.toContain('not a valid FCM registration token');
    }
  });

  it('sends to a topic and returns the messageId', async () => {
    sendMock.mockResolvedValue('projects/demo/messages/topic-1');

    const result = await sendNotification({
      ...base,
      target: { topic: 'news' },
    });

    expect(result).toEqual({ kind: 'topic', messageId: 'projects/demo/messages/topic-1' });
    expect(sendEachMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      topic: 'news',
      notification: { title: base.title, body: base.body },
    });
  });
});
