let stopped = false;

// Set the stop signal to true
export const stopSignal = () => { 
  stopped = true; 
};

// reset the stop signal to false
export const resetStopSignal = () => { 
  stopped = false; 
};

// Called to check if the stop signal has been set during processing
export const isStopped = () => stopped;
