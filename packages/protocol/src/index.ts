// Re-export all generated types and services
export * from './common';
export * from './messages';

// Utility functions for working with protocol messages
export class ProtocolUtils {
  /**
   * Create a Value from a primitive JavaScript value
   */
  static createValue(val: any): any {
    if (val === null || val === undefined) {
      return {};
    }
    
    if (typeof val === 'string') {
      return { stringValue: val };
    }
    
    if (typeof val === 'number') {
      return { numberValue: val };
    }
    
    if (typeof val === 'boolean') {
      return { boolValue: val };
    }
    
    if (Array.isArray(val)) {
      return {
        arrayValue: {
          items: val.map(item => this.createValue(item))
        }
      };
    }
    
    if (typeof val === 'object') {
      const fields: Record<string, any> = {};
      for (const [key, value] of Object.entries(val)) {
        fields[key] = this.createValue(value);
      }
      return {
        objectValue: { fields }
      };
    }
    
    throw new Error(`Unsupported value type: ${typeof val}`);
  }
  
  /**
   * Extract JavaScript value from a Value message
   */
  static extractValue(value: any): any {
    if (!value || !value.value) {
      return null;
    }
    
    const { value: val } = value;
    
    if ('stringValue' in val) return val.stringValue;
    if ('numberValue' in val) return val.numberValue;
    if ('boolValue' in val) return val.boolValue;
    
    if ('arrayValue' in val) {
      return val.arrayValue.items.map((item: any) => this.extractValue(item));
    }
    
    if ('objectValue' in val) {
      const result: Record<string, any> = {};
      for (const [key, fieldValue] of Object.entries(val.objectValue.fields)) {
        result[key] = this.extractValue(fieldValue);
      }
      return result;
    }
    
    return null;
  }
  
  /**
   * Generate a unique request ID
   */
  static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}