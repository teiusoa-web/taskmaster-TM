// validation.js - Module kiểm tra tính hợp lệ của Form (Thỏa mãn tiêu chí mục 10)

function parseLocalDate(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

export const Validation = {
  /**
   * Kiểm tra chuỗi có bị rỗng hay không
   * @param {string} value 
   * @returns {boolean}
   */
  isRequired(value) {
    return value !== null && value !== undefined && value.trim().length > 0;
  },

  /**
   * Kiểm tra độ dài tối thiểu
   * @param {string} value 
   * @param {number} min 
   * @returns {boolean}
   */
  minLength(value, min) {
    return value && value.trim().length >= min;
  },

  /**
   * Kiểm tra định dạng ngày hợp lệ (YYYY-MM-DD)
   * @param {string} dateStr 
   * @returns {boolean}
   */
  isValidDate(dateStr) {
    if (!dateStr) return false;
    if (parseLocalDate(dateStr)) return true;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  },

  /**
   * Kiểm tra hạn chót (Deadline + Giờ) có phải ở hiện tại hoặc tương lai không
   * @param {string} dateStr 
   * @param {string} timeStr
   * @returns {boolean}
   */
  isFutureOrToday(dateStr, timeStr = '23:59') {
    const localDate = parseLocalDate(dateStr);
    if (!localDate) {
      if (!this.isValidDate(dateStr)) return false;
      const fallback = new Date(dateStr);
      fallback.setHours(23, 59, 59, 999);
      return fallback >= new Date();
    }
    const timeMatch = /^(\d{2}):(\d{2})/.exec(String(timeStr || '').trim());
    const hours = timeMatch ? Math.min(23, Math.max(0, Number(timeMatch[1]))) : 23;
    const minutes = timeMatch ? Math.min(59, Math.max(0, Number(timeMatch[2]))) : 59;
    localDate.setHours(hours, minutes, 59, 999);
    return localDate >= new Date();
  },

  /**
   * Hiển thị thông báo lỗi ngay dưới thẻ input
   * @param {HTMLElement} inputElement 
   * @param {string} message 
   */
  showError(inputElement, message) {
    inputElement.classList.add('error');
    let errorElem = inputElement.parentElement.querySelector('.error-message');
    if (!errorElem) {
      errorElem = document.createElement('div');
      errorElem.className = 'error-message';
      inputElement.parentElement.appendChild(errorElem);
    }
    errorElem.textContent = message;
    errorElem.classList.add('show');
  },

  /**
   * Xóa thông báo lỗi của ô input
   * @param {HTMLElement} inputElement 
   */
  clearError(inputElement) {
    inputElement.classList.remove('error');
    const errorElem = inputElement.parentElement.querySelector('.error-message');
    if (errorElem) {
      errorElem.textContent = '';
      errorElem.classList.remove('show');
    }
  }
};
