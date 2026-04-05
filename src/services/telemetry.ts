export interface TelemetryEvent {
  type: string;
  timestamp: string;
  metadata?: Record<string, string | number>;
}

export type TelemetryEventType =
  | 'circuit_run'
  | 'exercise_complete'
  | 'learning_module_start'
  | 'hardware_job_submit'
  | 'dirac_query'
  | 'circuit_shared'
  | 'challenge_submitted'
  | 'plugin_installed';

class TelemetryService {
  private enabled = false;
  private queue: TelemetryEvent[] = [];

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.queue = [];
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  track(type: string, metadata?: Record<string, string | number>): void {
    if (!this.enabled) {
      return;
    }

    const event: TelemetryEvent = {
      type,
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.queue.push(event);
  }

  flush(): void {
    // In a real implementation this would send events to an analytics server.
    // For now we simply clear the queue.
    this.queue = [];
  }

  getStats(): { totalEvents: number; eventTypes: Record<string, number> } {
    const eventTypes: Record<string, number> = {};

    for (const event of this.queue) {
      eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
    }

    return {
      totalEvents: this.queue.length,
      eventTypes,
    };
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}

export const telemetry = new TelemetryService();
