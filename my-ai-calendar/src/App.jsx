import React, { useState, useEffect } from 'react';
import './index.css';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; // Removed signInWithCustomToken as it's Canvas-specific
import { getFirestore, collection, doc, setDoc, query, onSnapshot } from 'firebase/firestore';


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

        // Construct the suggestion message
        setProactiveSuggestion({
            message: `Heads up! It looks like you're at a "${mockCurrentLocationType}" type of place. You have "${suggestedEvent.title}" scheduled for ${eventDay}. Would you like to consider doing it now?`,
            eventDetails: suggestedEvent // Store event details for showing list, etc.
        });
    } else {
        setProactiveSuggestion(null); // No relevant suggestions
    }
  }, [mockCurrentLocationType, events]); // Dependencies: re-run when location or events change




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


  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-indigo-200 flex items-center justify-center p-4 sm:p-8">
      <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-xl w-full max-w-md md:max-w-xl lg:max-w-2xl">

        {/* Application Header */}
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 text-center leading-tight">
          🗓️ AI Calendar Assistant
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

        {/* Events Display Section */}
        <div className="mt-8 p-6 bg-blue-50 border-l-4 border-blue-500 text-blue-800 rounded-2xl shadow-inner">
          <h2 className="font-bold text-xl sm:text-2xl mb-4">Your Upcoming Events:</h2>
          {events.length === 0 ? (
            <p className="text-gray-600">No events added yet. Start by describing one above!</p>
          ) : (
            <ul className="divide-y divide-blue-200">
              {events.map((event) => (
                <li key={event.id} className="py-3">
                  <p className="font-semibold text-blue-900">{event.title}</p>
                  <p className="text-sm text-gray-700">{event.date} at {event.time}</p>
                  {event.description && <p className="text-xs text-gray-600 mt-1 italic">{event.description}</p>}
                  {event.locationType && <p className="text-xs text-gray-500 mt-1">Location Type: {event.locationType}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}

export default App;
