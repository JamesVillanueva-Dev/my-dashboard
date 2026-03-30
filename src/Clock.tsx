import { useState, useEffect } from 'react';


function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return <div>Current time: {time.toLocaleTimeString()}</div>;
}

export default Clock;