export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private nextIndex = 0;
  private size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.buffer[this.nextIndex] = item;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  toArray(): T[] {
    const result: T[] = new Array<T>(this.size);
    for (let i = 0; i < this.size; i++) {
      const idx = (this.nextIndex - this.size + i + this.capacity) % this.capacity;
      const val = this.buffer[idx];
      if (val !== undefined) result[i] = val;
    }
    return result;
  }

  length(): number {
    return this.size;
  }
}


