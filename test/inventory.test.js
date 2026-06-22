import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSku, reserveStock, summarizeBackorders } from '../src/inventory.js';

function createInventory() {
  return {
    'SKU-001': { available: 5, reservations: [] },
    'SKU-002': { available: 2, reservations: [] }
  };
}

describe('normalizeSku', () => {
  it('trims, uppercases, and removes internal separator noise', () => {
    assert.equal(normalizeSku(' sku 001 '), 'SKU-001');
    assert.equal(normalizeSku('sku_002'), 'SKU-002');
  });

  it('rejects blank SKUs', () => {
    assert.throws(() => normalizeSku('   '), /SKU cannot be blank/);
  });
});

describe('reserveStock', () => {
  it('reserves stock and records the reservation', () => {
    const inventory = createInventory();

    const result = reserveStock(inventory, {
      sku: 'sku 001',
      quantity: 3,
      reservationId: 'r-100'
    });

    assert.deepEqual(result, {
      status: 'reserved',
      sku: 'SKU-001',
      requested: 3,
      reserved: 3,
      remaining: 2
    });
    assert.deepEqual(inventory['SKU-001'].reservations, [
      { reservationId: 'r-100', quantity: 3 }
    ]);
  });

  it('is idempotent when the same reservation is retried', () => {
    const inventory = createInventory();
    const request = { sku: 'sku-001', quantity: 2, reservationId: 'r-200' };

    const first = reserveStock(inventory, request);
    const second = reserveStock(inventory, request);

    assert.deepEqual(second, first);
    assert.equal(inventory['SKU-001'].available, 3);
    assert.equal(inventory['SKU-001'].reservations.length, 1);
  });

  it('reports partial reservations without losing the reserved quantity', () => {
    const inventory = createInventory();

    const result = reserveStock(inventory, {
      sku: 'sku-002',
      quantity: 5,
      reservationId: 'r-300'
    });

    assert.deepEqual(result, {
      status: 'backordered',
      sku: 'SKU-002',
      requested: 5,
      reserved: 2,
      remaining: 0
    });
    assert.deepEqual(inventory['SKU-002'].reservations, [
      { reservationId: 'r-300', quantity: 2 }
    ]);
  });
});

describe('summarizeBackorders', () => {
  it('summarizes only the unfilled quantity', () => {
    const summary = summarizeBackorders([
      { status: 'reserved', sku: 'SKU-001', requested: 2, reserved: 2 },
      { status: 'backordered', sku: 'SKU-002', requested: 5, reserved: 2 },
      { status: 'backordered', sku: 'SKU-003', requested: 4, reserved: 0 }
    ]);

    assert.deepEqual(summary, [
      { sku: 'SKU-002', shortage: 3 },
      { sku: 'SKU-003', shortage: 4 }
    ]);
  });
});

