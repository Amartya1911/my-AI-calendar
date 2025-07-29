import React, { useState, useEffect } from 'react';

// Helper function to get the number of days in a month
const getDaysInMonth = (year, month) => {
  return new Date(year, month + 1, 0).getDate();
};

// Helper function to get the first day of the month (0 = Sunday, 1 = Monday, etc.)
const getFirstDayOfMonth = (year, month) => {
  return new Date(year, month, 1).getDay();
};

const CalendarGrid = ({ events, onSelectDate }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth()); // 0-indexed month
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(new Date()); // Represents the full date of the selected day

  // Normalize selectedDate to start of day for comparison
  useEffect(() => {
      const normalizedSelectedDate = new Date(selectedDate);
      normalizedSelectedDate.setHours(0, 0, 0, 0);
      onSelectDate(normalizedSelectedDate);
  }, [selectedDate, onSelectDate]);


  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfMonth = getFirstDayOfMonth(currentYear, currentMonth); // 0 = Sunday, 1 = Monday

  // Create an array to represent the days of the month grid
  const calendarDays = [];
  // Add empty cells for days before the 1st of the month
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  // Add days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  // Group events by date for easy lookup
  const eventsByDate = events.reduce((acc, event) => {
    const dateKey = event.date; // event.date is already YYYY-MM-DD
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {});

  // Handle month navigation
  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prevYear => prevYear - 1);
    } else {
      setCurrentMonth(prevMonth => prevMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prevYear => prevYear + 1);
    } else {
      setCurrentMonth(prevMonth => prevMonth + 1);
    }
  };

  const handleDayClick = (day) => {
    if (day) { // Ensure it's a valid day, not a null placeholder
      const newSelectedDate = new Date(currentYear, currentMonth, day);
      setSelectedDate(newSelectedDate);
    }
  };

  return (
    <div className="w-full">
      {/* Calendar Header with Month Navigation */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={goToPreviousMonth}
          className="px-4 py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition duration-200"
        >
          &lt; Prev
        </button>
        <h3 className="text-xl font-bold text-gray-800">
          {new Date(currentYear, currentMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </h3>
        <button
          onClick={goToNextMonth}
          className="px-4 py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition duration-200"
        >
          Next &gt;
        </button>
      </div>

      {/* Days of the Week Header */}
      <div className="grid grid-cols-7 text-center font-semibold text-gray-600 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="py-2">{day}</div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, index) => {
          const dateString = day ? `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
          const hasEvents = dateString && eventsByDate[dateString] && eventsByDate[dateString].length > 0;

          // Check if this is the selected day
          const isSelected = selectedDate && day &&
                             selectedDate.getDate() === day &&
                             selectedDate.getMonth() === currentMonth &&
                             selectedDate.getFullYear() === currentYear;

          // Check if this is today's date
          const today = new Date();
          const isToday = day &&
                          today.getDate() === day &&
                          today.getMonth() === currentMonth &&
                          today.getFullYear() === currentYear;

          return (
            <div
              key={index}
              className={`
                flex flex-col items-center justify-center p-2 rounded-lg aspect-square
                ${day ? 'cursor-pointer hover:bg-gray-200 transition duration-150 ease-in-out' : 'bg-gray-50'}
                ${isToday ? 'bg-indigo-200 text-indigo-900 font-bold border-2 border-indigo-500' : ''}
                ${isSelected ? 'bg-indigo-500 text-white font-bold border-2 border-indigo-700' : ''}
                ${hasEvents && !isSelected && !isToday ? 'bg-blue-100 text-blue-800 font-semibold' : ''}
                ${hasEvents && isSelected ? 'bg-indigo-700' : ''}
                ${hasEvents && isToday && !isSelected ? 'bg-indigo-300' : ''}
              `}
              onClick={() => handleDayClick(day)}
            >
              <span className="text-lg">{day}</span>
              {hasEvents && (
                <span className={`text-xs mt-1 px-1 rounded-full ${isSelected ? 'bg-white text-indigo-700' : isToday ? 'bg-indigo-500 text-white' : 'bg-blue-500 text-white'}`}>
                  {eventsByDate[dateString].length}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarGrid;