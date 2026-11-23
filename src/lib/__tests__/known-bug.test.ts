import { describe, it, expect } from 'vitest';
import { evaluateKnownBug } from './harness';

describe('evaluateKnownBug', () => {
  it('returns bug-appears-fixed when body passes', async () => {
    const result = await evaluateKnownBug(async () => {
      // Passes without throwing
    }, /some error/);

    expect(result.status).toBe('bug-appears-fixed');
    expect(result.message).toBe('bug appears fixed: convert this test to a normal test');
  });

  it('returns wrong-failure when error does not match pattern', async () => {
    const result = await evaluateKnownBug(async () => {
      throw new Error('Something completely unexpected occurred');
    }, /expected error pattern/);

    expect(result.status).toBe('wrong-failure');
    expect(result.message).toContain('Expected error matching');
    expect(result.message).toContain('Something completely unexpected occurred');
  });

  it('returns wrong-failure when error is a TypeError', async () => {
    const result = await evaluateKnownBug(async () => {
      // Trigger a TypeError
      const obj: any = null;
      obj.somePropertyAccess();
    }, /TypeError/);

    expect(result.status).toBe('wrong-failure');
    expect(result.message).toBeDefined();
  });

  it('returns wrong-failure when error is ReferenceError', async () => {
    const result = await evaluateKnownBug(async () => {
      throw new ReferenceError('someVariable is not defined');
    }, /someVariable/);

    expect(result.status).toBe('wrong-failure');
    expect(result.message).toContain('someVariable is not defined');
  });

  it('returns wrong-failure when error message is "No command was executed by the action"', async () => {
    const result = await evaluateKnownBug(async () => {
      throw new Error('No command was executed by the action.');
    }, /No command was executed by the action/);

    expect(result.status).toBe('wrong-failure');
  });

  it('returns failed-as-expected when error matches pattern and is an expected failure', async () => {
    const result = await evaluateKnownBug(async () => {
      throw new Error('expected [] to include K');
    }, /expected \[\] to include K/);

    expect(result.status).toBe('failed-as-expected');
    expect(result.message).toBe('expected [] to include K');
  });

  it('allows RangeError if pattern matches', async () => {
    const result = await evaluateKnownBug(async () => {
      throw new RangeError('Maximum call stack size exceeded');
    }, /Maximum call stack size exceeded/);

    expect(result.status).toBe('failed-as-expected');
  });
});
