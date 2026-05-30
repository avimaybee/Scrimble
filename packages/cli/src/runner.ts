import fs from 'fs';
import path from 'path';

export class LocalWorkflowRunner {
  private stateFilePath: string;
  public state: Record<string, any> = {};

  constructor(projectDir: string) {
    const scrimbleDir = path.join(projectDir, '.scrimble');
    if (!fs.existsSync(scrimbleDir)) {
      fs.mkdirSync(scrimbleDir, { recursive: true });
    }
    this.stateFilePath = path.join(scrimbleDir, 'workflow-state.json');
    this.loadState();
  }

  private loadState() {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const data = fs.readFileSync(this.stateFilePath, 'utf8');
        this.state = JSON.parse(data);
      } catch (e) {
        this.state = {};
      }
    }
  }

  private saveState() {
    fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  get isSuspended() {
    return this.state['_suspended_event'] !== undefined;
  }

  getSuspendedEvent() {
    return this.state['_suspended_event'];
  }
  
  injectEvent(payload: any) {
    this.state['_pending_event_payload'] = payload;
    this.saveState();
  }

  async do<T>(name: string, arg2?: any, arg3?: any): Promise<T> {
    const callback = typeof arg2 === 'function' ? arg2 : arg3;
    
    // If we have already completed this step, return the saved result
    if (this.state[name] && this.state[name].completed) {
      console.log(`[LocalWorkflow] Skipping already completed step: ${name}`);
      return this.state[name].result as T;
    }

    console.log(`[LocalWorkflow] Executing step: ${name}`);
    try {
      const result = await callback();
      this.state[name] = { completed: true, result };
      this.saveState();
      return result;
    } catch (e) {
      console.error(`[LocalWorkflow] Step failed: ${name}`, e);
      throw e;
    }
  }

  async waitForEvent<T>(name: string, config: any): Promise<T> {
    if (this.state[name] && this.state[name].completed) {
      console.log(`[LocalWorkflow] Event already provided: ${name}`);
      return this.state[name].result as T;
    }

    // Check if we have an injected event for this run
    if (this.state['_pending_event_payload']) {
       const payload = this.state['_pending_event_payload'];
       delete this.state['_pending_event_payload'];
       
       this.state[name] = { completed: true, result: payload };
       delete this.state['_suspended_event'];
       this.saveState();
       return payload as T;
    }

    console.log(`[LocalWorkflow] Suspending workflow to wait for event: ${config.type} (step: ${name})`);
    
    this.state['_suspended_event'] = {
      name,
      config
    };
    this.saveState();
    
    // We throw a special error to suspend execution
    throw new Error('WORKFLOW_SUSPENDED');
  }
}
