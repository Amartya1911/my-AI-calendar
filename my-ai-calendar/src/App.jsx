import React, { useState, useEffect,} from 'react';
import './index.css';
import CalendarGrid from './components/CalendarGrid';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; // Removed signInWithCustomToken as it's Canvas-specific
import { getFirestore, collection, doc, setDoc, query, onSnapshot, deleteDoc, updateDoc } from 'firebase/firestore';


function App() {
  // Existing states
  const [eventInput, setEventInput] = useState('');
  const [events, setEvents] = useState([]);
  const [parsedEvent, setParsedEvent] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // New states for Firebase
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  // No need for isLocalMode check, as it will always use provided env vars now

  // --- NEW STATE FOR MOCK LOCATION ---
  const [mockCurrentLocationType, setMockCurrentLocationType] = useState('');
  // --- NEW STATE FOR PROACTIVE SUGGESTIONS ---
  const [proactiveSuggestion, setProactiveSuggestion] = useState(null);

  // --- NEW STATE FOR EDITING ---
  const [editingEvent, setEditingEvent] = useState(null); // Stores the event object currently being edited
  // --- NEW STATE FOR MODAL FORM DATA ---
  const [editFormData, setEditFormData] = useState({
      title: '',
      date: '',
      time: '',
      description: '',
      locationType: ''
  });
  // --- NEW STATE FOR CALENDAR ---
  const [selectedDate, setSelectedDate] = useState(new Date()); // Holds the currently selected date in the calendar
  const [filteredEvents, setFilteredEvents] = useState([]); // Events for the selected date

  // --- NEW STATE FOR SCHEDULE OPTIMIZATION ---
  const [optimizationInput, setOptimizationInput] = useState('');
  const [optimizedSuggestions, setOptimizedSuggestions] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false); // To manage loading for optimization


  // --- Firebase Initialization and Authentication ---
  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        // --- Load Firebase config from .env variables ---
        const firebaseConfig = {
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: import.meta.env.VITE_FIREBASE_APP_ID,
          measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID // Optional
        };

        // Basic validation for Firebase config
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
          console.error("Firebase API Key or Project ID is missing from .env file. Please check your .env configuration.");
          setError("Firebase configuration missing. Check your .env file.");
          setIsAuthReady(true); // Allow UI to render even if Firebase fails
          return;
        }

        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuthInstance = getAuth(app);

        setDb(firestoreDb);
        setAuth(firebaseAuthInstance);

        // Use onAuthStateChanged for consistent user ID handling
        const unsubscribe = onAuthStateChanged(firebaseAuthInstance, async (user) => {
          if (user) {
            setUserId(user.uid);
            console.log("Firebase user ID:", user.uid);
          } else {
            // Sign in anonymously if no user is found
            await signInAnonymously(firebaseAuthInstance);
            console.log("Signed in anonymously.");
            // User ID will be set by the subsequent onAuthStateChanged callback
          }
          setIsAuthReady(true); // Mark auth as ready once the initial check is done
        });

        // Cleanup subscription on component unmount
        return () => unsubscribe();

      } catch (initError) {
        console.error("Error initializing Firebase or signing in:", initError);
        setError(`Failed to initialize Firebase: ${initError.message}. Check console for details.`);
        setIsAuthReady(true); // Allow UI to render even on error
      }
    };

    initializeFirebase();
  }, []); // Empty dependency array means this runs once on component mount

  // --- Fetch Events from Firestore ---
  useEffect(() => {
    if (db && userId && isAuthReady) {
      console.log(`Attempting to fetch events for user ${userId}`);
      // IMPORTANT: Re-structured Firestore path for general deployment
      // Use a simple, project-specific collection path directly under a 'users' collection
      const eventsCollectionRef = collection(db, `users/${userId}/calendarEvents`); // Unique path per user
      const q = query(eventsCollectionRef);

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedEvents = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // Sort events by date and then time on the client-side
        fetchedEvents.sort((a, b) => {
          const dateA = new Date(`${a.date}T${a.time}`);
          const dateB = new Date(`${b.date}T${b.time}`);
          return dateA.getTime() - dateB.getTime();
        });
        setEvents(fetchedEvents);
        console.log("Events updated:", fetchedEvents);
      }, (err) => {
        console.error("Error fetching events:", err);
        setError(`Failed to load events: ${err.message}`);
      });

      // Cleanup listener on component unmount or when db/userId/isAuthReady changes
      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady]); // Re-run when these dependencies change

  // --- NEW useEffect for Proactive Suggestions ---
  // This will run whenever events or mockCurrentLocationType changes
  useEffect(() => {
    if (!mockCurrentLocationType || events.length === 0) {
      setProactiveSuggestion(null); // Clear suggestion if no location set or no events
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of today
// Find upcoming events that match the current mock location type
    const matchingUpcomingEvents = events.filter(event => {
      // Check if event has a location type and it matches current mock location
      const locationMatches = event.locationType && event.locationType.toLowerCase() === mockCurrentLocationType.toLowerCase();
      
      // Check if the event is in the future relative to today
      const eventDate = new Date(event.date);
      eventDate.setHours(0, 0, 0, 0); // Normalize to start of event day

      // Only suggest events that are in the future
      const isUpcoming = eventDate.getTime() > today.getTime();

      // Additionally, consider events for "today" if current time is before event time
      if (eventDate.toDateString() === today.toDateString()) {
          const [eventHour, eventMinute] = event.time.split(':').map(Number);
          const eventDateTime = new Date();
          eventDateTime.setHours(eventHour, eventMinute, 0, 0);
          return locationMatches && eventDateTime.getTime() > new Date().getTime();
      }

      return locationMatches && isUpcoming;
    });


    // Sort by closest upcoming date
    matchingUpcomingEvents.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.time}`);
        const dateB = new Date(`${b.date}T${b.time}`);
        return dateA.getTime() - dateB.getTime();
    });

    if (matchingUpcomingEvents.length > 0) {
        const suggestedEvent = matchingUpcomingEvents[0]; // Suggest the soonest one
        const eventDay = new Date(suggestedEvent.date).toLocaleDateString('en-US', { weekday: 'long' });

        setProactiveSuggestion({
            message: `Heads up! It looks like you're at a "${mockCurrentLocationType}" type of place. You have "${suggestedEvent.title}" scheduled for ${eventDay}. Would you like to consider doing it now?`,
            eventDetails: suggestedEvent // Store event details for showing list, etc.
        });
    } else {
        setProactiveSuggestion(null); // No relevant suggestions
    }
}, [mockCurrentLocationType, events]); // Dependencies: re-run when location or events change
  
// --- NEW: Filter events based on selectedDate ---
useEffect(() => {
    // Normalize selectedDate to start of day for comparison
    const normalizedSelectedSelectedDate = new Date(selectedDate);
    normalizedSelectedSelectedDate.setHours(0, 0, 0, 0);

    const filtered = events.filter(event => {
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0); // Normalize event date to start of day

        return eventDate.getTime() === normalizedSelectedSelectedDate.getTime();
    });
    setFilteredEvents(filtered);
}, [events, selectedDate]);




  /**
   * Handles parsing the natural language event input using the LLM API.
   * It constructs a prompt, defines a response schema, and makes a fetch call to Gemini.
   */
  const handleParseEvent = async () => {
    if (!eventInput.trim()) {
      setError('Please enter an event description.');
      setParsedEvent(null);
      return;
    }

    setIsLoading(true);
    setError('');
    setParsedEvent(null);

    // --- Load Gemini API key from .env variables ---
    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!geminiApiKey) {
        setError("Gemini API Key is missing from .env file. Please add VITE_GEMINI_API_KEY.");
        setIsLoading(false);
        return;
    }

    // Define the prompt for the LLM
    const currentDate = new Date().toISOString().slice(0, 10);
    const nextDayDate = new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().slice(0, 10);

    const prompt = `
    You are an intelligent calendar assistant. Your task is to extract event details from the user's natural language input.
    Identify the 'title', 'date', 'time', 'description', and a new field 'locationType'. The 'locationType' should be a single word (e.g., "supermarket", "doctor", "office", "gym", "home", "bank", "restaurant") if the event clearly implies a type of location. If no specific location type is implied, set it to an empty string "".
    The date should be in 'YYYY-MM-DD' format. If a year is not specified, assume the current year.
    The time should be in 'HH:MM' (24-hour) format. If a time is not specified, default to '09:00'.
    The description should capture any additional relevant details not covered by title, date, or time, or any specific instructions.
    If no specific date is mentioned (e.g., "today", "tomorrow", "next Monday"), infer it based on the current date and day of the week.
    For recurring events, extract the core event details (title, first date/time, description) and note the recurrence pattern in the description if it's complex, otherwise, just extract the single instance.

    Today's date is ${currentDate}. Tomorrow's date is ${nextDayDate}.

    Example Input: "Lunch with Sarah next Monday at 1 PM about the marketing campaign"
    Example Output:
    {
        "title": "Lunch with Sarah",
        "date": "YYYY-MM-DD", // Placeholder: should be calculated based on next Monday relative to current date
        "time": "13:00",
        "description": "Discuss marketing campaign",
        "locationType": "restaurant" // Example: if LLM infers from "Lunch"
    }

    Example Input: "Team sync tomorrow morning"
    Example Output:
    {
        "title": "Team Sync",
        "date": "${nextDayDate}",
        "time": "09:00",
        "description": "",
        "locationType": "office" // Example: if LLM infers "Team sync" implies office
    }

    Example Input: "Dentist appointment on Jan 15th at 10 AM, make sure to bring X-rays"
    Example Output:
    {
        "title": "Dentist Appointment",
        "date": "YYYY-01-15", // Placeholder: replace YYYY with current year if not specified
        "time": "10:00",
        "description": "Bring X-rays",
        "locationType": "doctor" // Example: if LLM infers from "Dentist"
    }

    Example Input: "Weekly standup every Monday at 9:30 AM"
    Example Output:
    {
        "title": "Weekly Standup",
        "date": "YYYY-MM-DD", // Placeholder: should be calculated as next Monday
        "time": "09:30",
        "description": "Weekly recurring event",
        "locationType": "" // No specific location type implied
    }

    Example Input: "Grocery shopping on Friday evening, list: milk, eggs, bread"
    Example Output:
    {
        "title": "Grocery Shopping",
        "date": "YYYY-MM-DD", // Next Friday
        "time": "18:00", // Example evening time
        "description": "List: milk, eggs, bread",
        "locationType": "supermarket"
    }

    Now, parse the following event: "${eventInput}"
    `;

    // Define the JSON schema for the expected response from the LLM
    const responseSchema = {
        type: "OBJECT",
        properties: {
            title: { "type": "STRING" },
            date: { "type": "STRING", "format": "date-time" },
            time: { "type": "STRING", "pattern": "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$" },
            description: { "type": "STRING" },
            locationType: { "type": "STRING"}
        },
        required: ["title", "date", "time", "locationType"]
    };

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`; // Use local API key

    let retries = 0;
    const maxRetries = 3;
    const baseDelay = 1000;

    while (retries < maxRetries) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('LLM API Error Response:', errorData);
                throw new Error(`LLM API request failed with status: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {

                const jsonString = result.candidates[0].content.parts[0].text;
                try {
                    const parsed = JSON.parse(jsonString);

                    if (parsed.title && parsed.date && parsed.time) {
                        let finalDate = parsed.date;
                        // Basic year inference for MM-DD or YY-MM-DD formats
                        if (finalDate.match(/^\d{2}-\d{2}$/)) {
                            finalDate = new Date().getFullYear() + '-' + finalDate;
                        } else if (finalDate.match(/^\d{2}-\d{2}-\d{2}$/)) {
                            finalDate = `20${finalDate}`;
                        }

                        const finalParsedEvent = {
                          title: parsed.title,
                          date: finalDate,
                          time: parsed.time,
                          description: parsed.description || '',
                          locationType: parsed.locationType || ''
                        };

                        setParsedEvent(finalParsedEvent);

                        // --- Save the event to Firestore ---
                        if (db && userId) { // No longer need !isLocalMode as isLocalMode is removed
                          // IMPORTANT: Use a generic collection path for general deployment
                          const eventsCollectionRef = collection(db, `users/${userId}/calendarEvents`);
                          await setDoc(doc(eventsCollectionRef), finalParsedEvent);
                          console.log("Event saved to Firestore:", finalParsedEvent);
                        } else {
                          // Fallback for when DB isn't ready (e.g., initial load or error)
                          setEvents(prevEvents => {
                            return [...prevEvents, { ...finalParsedEvent, id: Date.now().toString() }];
                          });
                          console.warn("Firebase DB not ready, event added to local state only (not persistent).");
                        }
                        setEventInput('');
                        break;

                    } else {
                        setError('LLM returned incomplete or invalid event data. Please try rephrasing.');
                        console.error('Incomplete LLM data:', parsed);
                    }

                } catch (parseError) {
                    setError('Failed to parse LLM response JSON. The AI might have returned an unexpected format. Please try again.');
                    console.error('JSON parsing error:', parseError);
                    console.error('Raw LLM response:', jsonString);
                }
            } else {
                setError('LLM response was empty or malformed. Please try again.');
                console.error('Malformed LLM response:', result);
            }
        } catch (fetchError) {
            console.error('Fetch error during LLM call:', fetchError);
            retries++;
            if (retries < maxRetries) {
                const delay = baseDelay * Math.pow(2, retries - 1);
                console.warn(`Retrying LLM call in ${delay / 1000} seconds... (Attempt ${retries}/${maxRetries})`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                setError(`Failed to get a valid response from LLM after ${maxRetries} attempts. Please check your prompt or ensure your API key is correct and try again later.`);
            }
        } finally {
            setIsLoading(false);
        }
    }
  };
  const handleDeleteEvent = async (eventId) => {
  if (!db || !userId) {
    setError("Firebase is not initialized or user is not authenticated. Cannot delete event.");
    return;
  }

  setIsLoading(true); // Can show loading if delete takes time
  setError('');

  try {
    const eventsCollectionRef = collection(db, `users/${userId}/calendarEvents`);
    const eventDocRef = doc(eventsCollectionRef, eventId); // Reference to the specific document
    await deleteDoc(eventDocRef); // Use deleteDoc to remove it
    console.log("Event successfully deleted:", eventId);
    // Firestore's onSnapshot listener will automatically update the `events` state,
    // so no need to manually remove from local state here.
  } catch (deleteError) {
    console.error("Error deleting event:", deleteError);
    setError(`Failed to delete event: ${deleteError.message}`);
  } finally {
    setIsLoading(false); // End loading
  }
}

// --- NEW: Function to open edit modal ---
const handleEditEvent = (eventToEdit) => {
    setEditingEvent(eventToEdit);
    setEditFormData({
        title: eventToEdit.title,
        date: eventToEdit.date,
        time: eventToEdit.time,
        description: eventToEdit.description || '',
        locationType: eventToEdit.locationType || ''
    });
};

// --- NEW: Function to close edit modal ---
const handleCloseEditModal = () => {
    setEditingEvent(null);
    setEditFormData({
        title: '',
        date: '',
        time: '',
        description: '',
        locationType: ''
    });
    setError(''); // Clear any errors from the modal
};

// --- NEW: Function to update an event in Firestore ---
const handleUpdateEvent = async () => {
    if (!db || !userId || !editingEvent) {
        setError("Firebase is not initialized, user is not authenticated, or no event selected for editing.");
        return;
    }
    if (!editFormData.title || !editFormData.date || !editFormData.time) {
        setError("Title, Date, and Time are required for an event.");
        return;
    }

    setIsLoading(true); // Show loading state
    setError('');

    try {
        const eventsCollectionRef = collection(db, `users/${userId}/calendarEvents`);
        const eventDocRef = doc(eventsCollectionRef, editingEvent.id); // Reference to the specific document
        await updateDoc(eventDocRef, {
            title: editFormData.title,
            date: editFormData.date,
            time: editFormData.time,
            description: editFormData.description,
            locationType: editFormData.locationType
        });
        console.log("Event successfully updated:", editingEvent.id);
        handleCloseEditModal(); // Close modal after successful update
    } catch (updateError) {
        console.error("Error updating event:", updateError);
        setError(`Failed to update event: ${updateError.message}`);
    } finally {
        setIsLoading(false); // End loading
    }
};

// --- NEW: Function to handle schedule optimization ---
  const handleOptimizeSchedule = async () => {
    if (!optimizationInput.trim()) {
        setError("Please describe the schedule change or task for optimization.");
        return;
    }

    setIsOptimizing(true);
    setError('');
    setOptimizedSuggestions(null);

    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!geminiApiKey) {
        setError("Gemini API Key is missing. Cannot optimize schedule.");
        setIsOptimizing(false);
        return;
    }

    // Prepare current schedule context for the LLM
    const formattedEvents = events.map(event => (
      `- ID: ${event.id}, Title: ${event.title}, Date: ${event.date}, Time: ${event.time}, Description: ${event.description || 'N/A'}, Location Type: ${event.locationType || 'N/A'}`
  )).join('\n');

    const prompt = `
    You are an intelligent calendar optimization assistant.
  I will provide you with my current schedule and a new request or change.
  Your task is to analyze my current schedule and the new request/change, and then propose an optimal updated plan.

  **Instructions for Generating Changes:**
  1.  **Prioritize minimal disruption:** Try to fit new tasks without moving too many existing events.
  2.  **Handle cancellations:** If a specific event is cancelled, suggest a "delete" action for that event.
  3.  **Utilize freed time:** If time is freed up, suggest moving an *existing* relevant event into that slot, or adding a new general "focus time" event if no specific task is moved. Use the 'move' type for existing events, including their original 'eventId'.
  4.  **Handle new urgent tasks/clashes:** If a new task conflicts with an existing event, suggest moving the *existing* event to accommodate the new one, especially if the new task is urgent or given a specific time. If an existing event needs to be moved, use its 'eventId' from 'My Current Schedule'.
  5.  **Always provide 'eventId'**: For 'move' and 'delete' operations, you MUST include the 'eventId' corresponding to the event in 'My Current Schedule'.
  6.  **Return actionable changes**: Each change must be one of 'add', 'move', or 'delete'.

  Return your suggestions as a JSON object with an array of "suggestions". Each suggestion should include a "description" (natural language summary) and "changes" (an array of event modifications).


  Current Date: ${new Date().toISOString().slice(0, 10)}
  Current Time: ${new Date().toTimeString().slice(0, 5)}

  My Current Schedule (Upcoming Events):
  ${formattedEvents.length > 0 ? formattedEvents : "No upcoming events."}

  New Request/Change: "${optimizationInput}"

  ---
  **Example Scenarios and Expected Outputs:**

  **Scenario 1: Meeting Cancellation & Filling Free Slot**
  * User Input: "My meeting with client on Monday at 10 AM got canceled. Suggest something for that free time."
  * Assume My Current Schedule includes: - ID: meeting_id_1, Title: "Meeting with client", Date: 2025-08-04, Time: 10:00, ... and - ID: deep_work_id_1, Title: "Deep work session", Date: 2025-08-04, Time: 14:00, ...
  * Expected Output:
      {
        "suggestions": [
          {
            "description": "Your meeting with client on Monday, August 4th at 10:00 AM has been cancelled. I suggest moving your 'Deep work session' to fill this slot.",
            "changes": [
              {
                "type": "delete",
                "eventTitle": "Meeting with client",
                "eventId": "meeting_id_1"
              },
              {
                "type": "move",
                "eventTitle": "Deep work session",
                "eventId": "deep_work_id_1",
                "oldTime": "14:00",
                "newTime": "10:00"
              }
            ]
          }
        ]
      }

  **Scenario 2: New Urgent Task with Potential Clash**
  * User Input: "I need to add an urgent report meeting tomorrow that will take 1 hour, try to fit it in before lunch."
  * Assume "My Current Schedule" includes: '- ID: lunch_id_1, Title: "Lunch with Sarah", Date: 2025-07-30, Time: 12:00, ...'
  * Expected Output (if it needs to move Lunch):
      {
        "suggestions": [
          {
            "description": "To fit the urgent report meeting, I suggest moving 'Lunch with Sarah' and adding the new report meeting at 11:00.",
            "changes": [
              {
                "type": "add",
                "eventDetails": {
                  "title": "Urgent Report Meeting",
                  "date": "2025-07-30",
                  "time": "11:00",
                  "description": "Prepare urgent report",
                  "locationType": "office"
                }
              },
              {
                "type": "move",
                "eventTitle": "Lunch with Sarah",
                "eventId": "lunch_id_1",
                "oldTime": "12:00",
                "newTime": "13:00"
              }
            ]
          }
        ]
      }

  **Scenario 3: New Task, No Clash, Fits Well**
  * User Input: "Add a quick 30-minute call with Mike tomorrow morning."
  * Assume 'My Current Schedule' has a free slot at 9:00 AM.
  * Expected Output:
      {
        "suggestions": [
          {
            "description": "I found a free slot for your call with Mike tomorrow morning.",
            "changes": [
              {
                "type": "add",
                "eventDetails": {
                  "title": "Call with Mike",
                  "date": "2025-07-30",
                  "time": "09:00",
                  "description": "Quick sync",
                  "locationType": "office"
                }
              }
            ]
          }
        ]
      }

  Please provide your optimal schedule suggestions based on the New Request/Change.
  `;
  // Define the JSON schema for the expected response from the LLM for optimization
  const responseSchema = {
      type: "OBJECT",
      properties: {
          suggestions: {
              type: "ARRAY",
              items: {
                  type: "OBJECT",
                  properties: {
                      description: { "type": "STRING" },
                      changes: {
                          type: "ARRAY",
                          items: {
                              type: "OBJECT",
                              properties: {
                                  type: { "type": "STRING", "enum": ["add", "move", "delete"] },
                                  eventTitle: { "type": "STRING" },
                                  eventId: { "type": "STRING" }, // <-- NEW: Add eventId for move/delete
                                  oldTime: { "type": "STRING", "pattern": "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$" },
                                  newTime: { "type": "STRING", "pattern": "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$" },
                                  eventDetails: { // For 'add' type changes
                                      type: "OBJECT",
                                      properties: {
                                          title: { "type": "STRING" },
                                          date: { "type": "STRING" }, // Removed format: "date-time" from LLM parsing here
                                          time: { "type": "STRING", "pattern": "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$" },
                                          description: { "type": "STRING" },
                                          locationType: { "type": "STRING" }
                                      },
                                      required: ["title", "date", "time"]
                                  }
                              },
                              required: ["type"] // Only type is always required initially; eventTitle/eventId for move/delete depends on type
                          }
                      }
                  },
                  required: ["description", "changes"]
              }
          }
      },
      required: ["suggestions"]
  };


    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;

    let retries = 0;
    const maxRetries = 3;
    const baseDelay = 1000;

    while (retries < maxRetries) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('LLM Optimization API Error Response:', errorData);
                throw new Error(`LLM Optimization API request failed with status: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }

            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const jsonString = result.candidates[0].content.parts[0].text;
                try {
                    const parsedSuggestions = JSON.parse(jsonString);
                    if (parsedSuggestions.suggestions && Array.isArray(parsedSuggestions.suggestions)) {
                        setOptimizedSuggestions(parsedSuggestions.suggestions);
                        setOptimizationInput(''); // Clear input after successful processing
                        break;
                    } else {
                        setError('LLM returned an invalid suggestion format. Please try rephrasing.');
                        console.error('Invalid LLM suggestion format:', parsedSuggestions);
                    }
                } catch (parseError) {
                    setError('Failed to parse LLM optimization response JSON. Please try again.');
                    console.error('JSON parsing error (optimization):', parseError);
                    console.error('Raw LLM optimization response:', jsonString);
                }
            } else {
                setError('LLM optimization response was empty or malformed. Please try again.');
                console.error('Malformed LLM optimization response:', result);
            }
        } catch (fetchError) {
            console.error('Fetch error during LLM optimization call:', fetchError);
            retries++;
            if (retries < maxRetries) {
                const delay = baseDelay * Math.pow(2, retries - 1);
                console.warn(`Retrying LLM optimization call in ${delay / 1000} seconds... (Attempt ${retries}/${maxRetries})`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                setError(`Failed to get a valid response from LLM for optimization after ${maxRetries} attempts.`);
            }
        } finally {
            setIsOptimizing(false);
        }
    }
  };

  // --- NEW: Function to accept optimization suggestions ---
const handleAcceptSuggestion = async (suggestionChanges) => {
    if (!db || !userId) {
        setError("Firebase not initialized or user not authenticated. Cannot apply changes.");
        return;
    }

    setIsLoading(true); // Re-using isLoading for global operations
    setError('');

    try {
        const eventsCollectionRef = collection(db, `users/${userId}/calendarEvents`);

        for (const change of suggestionChanges) {
            if (change.type === 'add' && change.eventDetails) {
                // Add a new event
                const newEventData = {
                    title: change.eventDetails.title,
                    date: change.eventDetails.date,
                    time: change.eventDetails.time,
                    description: change.eventDetails.description || '',
                    locationType: change.eventDetails.locationType || ''
                };
                await setDoc(doc(eventsCollectionRef), newEventData);
                console.log("Added new event:", newEventData.title);
            } else if (change.type === 'move' && change.eventId && change.newTime) {
                // Move (update time) of an existing event
                const eventDocRef = doc(eventsCollectionRef, change.eventId);
                await updateDoc(eventDocRef, { time: change.newTime });
                console.log(`Moved event ${change.eventTitle} (ID: ${change.eventId}) to ${change.newTime}`);
            } else if (change.type === 'delete' && change.eventId) {
                // Delete an existing event
                const eventDocRef = doc(eventsCollectionRef, change.eventId);
                await deleteDoc(eventDocRef);
                console.log(`Deleted event ${change.eventTitle} (ID: ${change.eventId})`);
            } else {
                console.warn("Unknown or incomplete change type received from LLM:", change);
                // Optionally, show an error to the user for malformed suggestions
            }
        }
        setOptimizedSuggestions(null); // Clear suggestions after applying
        setOptimizationInput(''); // Clear input
        console.log("Optimization suggestions applied successfully.");

    } catch (applyError) {
        console.error("Error applying optimization suggestions:", applyError);
        setError(`Failed to apply optimization: ${applyError.message}`);
    } finally {
        setIsLoading(false);
    }
};

// --- NEW: Function to ignore optimization suggestions ---
const handleIgnoreSuggestion = () => {
    setOptimizedSuggestions(null); // Clear suggestions
    setOptimizationInput(''); // Clear input
    console.log("Optimization suggestions ignored.");
};


  return (
  <div className="min-h-screen bg-gradient-to-br from-purple-100 to-indigo-200 flex items-center justify-center p-4 sm:p-8">
    <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-xl w-full max-w-md md:max-w-xl lg:max-w-2xl">

      {/* Application Header */}
      <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 text-center leading-tight">
        🗓️ AI (Amartya's Intelligent) Calendar Assistant
      </h1>
      <p className="text-gray-600 text-base sm:text-lg mb-8 text-center">
        Your smart assistant to effortlessly manage your schedule.
      </p>

      {/* User ID Display */}
      {userId && (
        <p className="text-gray-500 text-sm mb-4 text-center break-words">
          Your User ID: <span className="font-mono text-xs bg-gray-100 p-1 rounded">{userId}</span>
        </p>
      )}

      {/* Error Message Display */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-xl relative mb-6" role="alert">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline ml-2">{error}</span>
        </div>
      )}

      {/* Event Input Section */}
      <div className="mb-8 p-6 bg-gray-50 rounded-2xl shadow-inner">
        <label htmlFor="eventInput" className="block text-gray-700 text-lg sm:text-xl font-bold mb-3">
          What's happening? Tell me in natural language:
        </label>
        <textarea
          id="eventInput"
          className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition duration-200 ease-in-out resize-y"
          rows="4"
          placeholder="e.g., 'Team meeting on Friday at 10 AM for two hours', 'Doctor's appointment tomorrow at 3pm with Dr. Smith', 'Pick up dry cleaning on Wednesday afternoon'"
          value={eventInput}
          onChange={(e) => setEventInput(e.target.value)}
        ></textarea>
        <button
          onClick={handleParseEvent}
          className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105"
          disabled={isLoading || !isAuthReady}
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </span>
          ) : (
            'Parse & Add Event'
          )}
        </button>
      </div>

      {/* Displaying LLM Parsed Event */}
      {parsedEvent && (
        <div className="mt-6 bg-green-50 border-l-4 border-green-500 text-green-800 p-4 rounded-xl shadow-inner">
          <h2 className="font-bold text-lg mb-2">AI Parsed Details:</h2>
          <ul className="list-disc list-inside text-gray-800">
            <li><strong>Title:</strong> {parsedEvent.title}</li>
            <li><strong>Date:</strong> {parsedEvent.date}</li>
            <li><strong>Time:</strong> {parsedEvent.time}</li>
            <li><strong>Description:</strong> {parsedEvent.description || 'N/A'}</li>
            <li><strong>Location Type:</strong> {parsedEvent.locationType || 'N/A'}</li>
          </ul>
        </div>
      )}

      {/* --- NEW: Mock Current Location Input --- */}
      <div className="mb-8 p-6 bg-gray-50 rounded-2xl shadow-inner">
        <label htmlFor="mockLocation" className="block text-gray-700 text-lg sm:text-xl font-bold mb-3">
          Simulate Current Location Type:
        </label>
        <input
          id="mockLocation"
          type="text"
          className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
          placeholder="e.g., supermarket, office, gym"
          value={mockCurrentLocationType}
          onChange={(e) => setMockCurrentLocationType(e.target.value)}
        />
      </div>

      {/* --- NEW: Proactive Suggestion Display --- */}
      {proactiveSuggestion && (
        <div className="mt-6 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-xl shadow-inner">
          <h2 className="font-bold text-lg mb-2">Proactive Suggestion:</h2>
          <p className="mb-2">{proactiveSuggestion.message}</p>
          {/* Optionally display more event details like the description/list */}
          {proactiveSuggestion.eventDetails.description && (
            <p className="text-sm italic">Details: {proactiveSuggestion.eventDetails.description}</p>
          )}
        </div>
      )}

      {/* --- NEW: Schedule Optimization Section --- */}
      <div className="mt-8 p-6 bg-gray-50 rounded-2xl shadow-inner">
        <label htmlFor="optimizationInput" className="block text-gray-700 text-lg sm:text-xl font-bold mb-3">
          Optimize Schedule: (e.g., "My 10 AM meeting got canceled", "I need 2 hours for a new urgent report")
        </label>
        <textarea
          id="optimizationInput"
          className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out resize-y"
          rows="3"
          placeholder="Describe a change or new task..."
          value={optimizationInput}
          onChange={(e) => setOptimizationInput(e.target.value)}
        ></textarea>
        <button
          onClick={handleOptimizeSchedule}
          className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl focus:outline-none focus:shadow-outline transition duration-300 ease-in-out transform hover:scale-105"
          disabled={isOptimizing || !isAuthReady}
        >
          {isOptimizing ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Optimizing...
            </span>
          ) : (
            'Optimize Schedule'
          )}
        </button>
      </div>

      {/* --- NEW: Optimized Suggestions Display --- */}
      {optimizedSuggestions && optimizedSuggestions.length > 0 && (
    <div className="mt-6 bg-purple-50 border-l-4 border-purple-500 text-purple-800 p-4 rounded-xl shadow-inner">
        <h2 className="font-bold text-lg mb-2">Optimization Suggestions:</h2>
        {optimizedSuggestions.map((suggestion, index) => (
            <div key={index} className="mb-4 last:mb-0 p-3 bg-purple-100 rounded-lg">
                <p className="mb-2 text-purple-900">{suggestion.description}</p>
                {suggestion.changes && suggestion.changes.length > 0 && (
                    <ul className="list-disc list-inside text-sm text-purple-700">
                        {suggestion.changes.map((change, changeIndex) => (
                            <li key={changeIndex}>
                                {change.type === 'add' && `Add: "${change.eventDetails.title}" on ${change.eventDetails.date} at ${change.eventDetails.time}`}
                                {change.type === 'move' && `Move: "${change.eventTitle}" from ${change.oldTime} to ${change.newTime}`}
                                {change.type === 'delete' && `Delete: "${change.eventTitle}"`}
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex justify-end mt-3 space-x-2">
                    {/* --- ENABLED AND CONNECTED BUTTONS --- */}
                    <button
                        onClick={() => handleAcceptSuggestion(suggestion.changes)}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-xs py-1 px-3 rounded-md transition duration-200"
                        disabled={isLoading} // Use global isLoading for all major actions
                    >
                        Accept
                    </button>
                    <button
                        onClick={handleIgnoreSuggestion}
                        className="bg-gray-400 hover:bg-gray-500 text-white text-xs py-1 px-3 rounded-md transition duration-200"
                        disabled={isLoading}
                    >
                        Ignore
                    </button>
                </div>
            </div>
        ))}
    </div>
)}

      {/* --- Calendar Grid Component --- */}
      <div className="mt-8 p-6 bg-white-50 rounded-2xl shadow-inner border border-gray-200">
        <CalendarGrid events={events} onSelectDate={setSelectedDate} />
      </div>

      {/* --- Events for Selected Date Display --- */}
      <div className="mt-8 p-6 bg-blue-50 border-l-4 border-blue-500 text-blue-800 rounded-2xl shadow-inner">
        <h2 className="font-bold text-xl sm:text-2xl mb-4">Events for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}:</h2>
        {filteredEvents.length === 0 ? (
          <p className="text-gray-600">No events on this day.</p>
        ) : (
          <ul className="divide-y divide-blue-200">
            {filteredEvents.map((event) => (
              <li key={event.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-blue-900">{event.title}</p>
                  <p className="text-sm text-gray-700">{event.time}</p> {/* Only time here now */}
                  {event.description && <p className="text-xs text-gray-600 mt-1 italic">{event.description}</p>}
                  {event.locationType && <p className="text-xs text-gray-500 mt-1">Location Type: {event.locationType}</p>}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleEditEvent(event)}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-1 px-3 rounded-md text-sm focus:outline-none focus:shadow-outline transition duration-200 ease-in-out transform hover:scale-105"
                    disabled={isLoading}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteEvent(event.id)}
                    className="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded-md text-sm focus:outline-none focus:shadow-outline transition duration-200 ease-in-out transform hover:scale-105"
                    disabled={isLoading}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- Edit Event Modal (Conditional Rendering) --- */}
      {editingEvent && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Edit Event</h2>

            {/* Error display for modal */}
            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-xl relative mb-4" role="alert">
                <strong className="font-bold">Error!</strong>
                <span className="block sm:inline ml-2">{error}</span>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); handleUpdateEvent(); }}>
              <div className="mb-4">
                <label htmlFor="editTitle" className="block text-gray-700 text-sm font-bold mb-2">Title:</label>
                <input
                  type="text"
                  id="editTitle"
                  className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={editFormData.title}
                  onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                  required
                />
              </div>
              <div className="mb-4">
                <label htmlFor="editDate" className="block text-gray-700 text-sm font-bold mb-2">Date (YYYY-MM-DD):</label>
                <input
                  type="date"
                  id="editDate"
                  className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={editFormData.date}
                  onChange={(e) => setEditFormData({ ...editFormData, date: e.target.value })}
                  required
                />
              </div>
              <div className="mb-4">
                <label htmlFor="editTime" className="block text-gray-700 text-sm font-bold mb-2">Time (HH:MM):</label>
                <input
                  type="time"
                  id="editTime"
                  className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={editFormData.time}
                  onChange={(e) => setEditFormData({ ...editFormData, time: e.target.value })}
                  required
                />
              </div>
              <div className="mb-4">
                <label htmlFor="editDescription" className="block text-gray-700 text-sm font-bold mb-2">Description:</label>
                <textarea
                  id="editDescription"
                  className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                  rows="3"
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                ></textarea>
              </div>
              <div className="mb-6">
                <label htmlFor="editLocationType" className="block text-gray-700 text-sm font-bold mb-2">Location Type:</label>
                <input
                  type="text"
                  id="editLocationType"
                  className="shadow-sm appearance-none border border-gray-300 rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g., supermarket, office"
                  value={editFormData.locationType}
                  onChange={(e) => setEditFormData({ ...editFormData, locationType: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-end space-x-4">
                <button
                  type="button"
                  onClick={handleCloseEditModal}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-200 ease-in-out"
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-200 ease-in-out transform hover:scale-105"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin h-4 w-4 mr-2 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </span>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}

export default App;
