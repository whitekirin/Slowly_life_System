import { describe, it, expect, vi } from 'vitest';
import { editorConfig } from './editorConfig';

describe('Jodit Editor Color Buttons', () => {
  it('textColor button isolates color tab and returns correct node', () => {
    const mockPopupNode = {
      container: {
        querySelector: vi.fn((selector) => {
          if (selector === '.jodit-tabs__buttons') {
            return { style: { display: 'block' } };
          }
          return null;
        })
      }
    };

    const mockBrushPopup = vi.fn().mockReturnValue(mockPopupNode);

    const mockEditor = {
      o: { colorPickerDefaultTab: 'background' },
      constructor: {
        defaultOptions: {
          controls: {
            brush: {
              popup: mockBrushPopup
            }
          }
        }
      }
    };

    const mockCurrent = {};
    const mockClose = vi.fn();
    const mockButton = {};

    const result = editorConfig.controls.textColor.popup(mockEditor, mockCurrent, mockClose, mockButton);

    // Verify default tab was temporarily changed to 'color'
    // but restored afterwards
    expect(mockEditor.o.colorPickerDefaultTab).toBe('background'); // Restored
    
    // Verify brush popup was called
    expect(mockBrushPopup).toHaveBeenCalledWith(mockEditor, mockCurrent, mockClose, mockButton);

    // Verify tabs container was hidden
    const buttonsContainer = mockPopupNode.container.querySelector.mock.results[0].value;
    expect(buttonsContainer.style.display).toBe('none');

    // Verify it returns the node
    expect(result).toBe(mockPopupNode);
  });

  it('bgColor button isolates background tab and returns correct node', () => {
    const mockPopupNode = {
      container: {
        querySelector: vi.fn((selector) => {
          if (selector === '.jodit-tabs__buttons') {
            return { style: { display: 'block' } };
          }
          return null;
        })
      }
    };

    const mockBrushPopup = vi.fn().mockReturnValue(mockPopupNode);

    const mockEditor = {
      o: { colorPickerDefaultTab: 'color' }, // Original is color
      constructor: {
        defaultOptions: {
          controls: {
            brush: {
              popup: mockBrushPopup
            }
          }
        }
      }
    };

    const result = editorConfig.controls.bgColor.popup(mockEditor, {}, vi.fn(), {});

    // Verify default tab was restored
    expect(mockEditor.o.colorPickerDefaultTab).toBe('color'); // Restored
    
    // Verify tabs container was hidden
    const buttonsContainer = mockPopupNode.container.querySelector.mock.results[0].value;
    expect(buttonsContainer.style.display).toBe('none');
  });
});
