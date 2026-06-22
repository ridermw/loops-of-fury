export function normalizeSku(input) {
  if (typeof input !== 'string') {
    throw new TypeError('SKU must be a string');
  }

  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');

  if (!normalized) {
    throw new RangeError('SKU cannot be blank');
  }

  return normalized;
}

export function reserveStock(inventory, request) {
  const sku = normalizeSku(request.sku);
  const quantity = request.quantity;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('Reservation quantity must be a positive integer');
  }

  const item = inventory[sku];
  if (!item) {
    return {
      status: 'backordered',
      sku,
      requested: quantity,
      reserved: 0,
      remaining: 0
    };
  }

  const existing = item.reservations.find(
    (reservation) => reservation.reservationId === request.reservationId
  );
  if (existing) {
    return {
      status: existing.quantity === quantity ? 'reserved' : 'backordered',
      sku,
      requested: quantity,
      reserved: existing.quantity,
      remaining: item.available
    };
  }

  const reserved = Math.min(item.available, quantity);
  item.available -= reserved;
  item.reservations.push({
    reservationId: request.reservationId,
    quantity: reserved
  });

  return {
    status: reserved === quantity ? 'reserved' : 'backordered',
    sku,
    requested: quantity,
    reserved,
    remaining: item.available
  };
}

export function summarizeBackorders(results) {
  return results
    .filter((result) => result.status === 'backordered')
    .map((result) => ({
      sku: result.sku,
      shortage: result.requested - result.reserved
    }));
}

