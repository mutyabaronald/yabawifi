/**
 * Utility to handle browser extension communication errors
 * These errors are common and don't affect the application functionality
 */

export const isExtensionError = (error) => {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  const errorString = error.toString();
  
  const extensionErrorPatterns = [
    'Could not establish connection',
    'Receiving end does not exist',
    'background page',
    'message channel closed',
    'Extension context invalidated',
    'The message port closed',
    'Could not establish connection. Receiving end does not exist',
    'You do not have a background page',
    'inlineForm.html',
    'abine55835212doNotRemove',
    'runtime.lastError',
    'Unchecked runtime.lastError'
  ];
  
  return extensionErrorPatterns.some(pattern => 
    errorMessage.includes(pattern) || errorString.includes(pattern)
  );
};

export const handleExtensionError = (error, context = 'Unknown') => {
  if (isExtensionError(error)) {
    console.warn(`Browser extension communication error in ${context} (ignored):`, error.message);
    return true; // Error was handled
  }
  return false; // Error was not an extension error
};

export const setupGlobalExtensionErrorHandlers = () => {
  // Handle synchronous errors
  window.addEventListener('error', (event) => {
    if (isExtensionError(event.error)) {
      console.warn("Browser extension error (ignored):", event.error?.message || event.error);
      event.preventDefault();
      return false;
    }
  });

  // Handle promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (isExtensionError(event.reason)) {
      console.warn("Browser extension promise rejection (ignored):", event.reason?.message || event.reason);
      event.preventDefault();
      return false;
    }
  });

  // Handle console errors from extensions
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const errorMessage = args.join(' ');
    if (errorMessage.includes('runtime.lastError') || 
        errorMessage.includes('background page') ||
        errorMessage.includes('inlineForm.html') ||
        errorMessage.includes('abine55835212doNotRemove')) {
      console.warn("Browser extension console error (ignored):", ...args);
      return;
    }
    originalConsoleError.apply(console, args);
  };
};

export default {
  isExtensionError,
  handleExtensionError,
  setupGlobalExtensionErrorHandlers
};












