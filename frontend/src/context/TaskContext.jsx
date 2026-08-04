import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTasks, subscribeTasks, subscribeTask } from '../utils/api';

const TaskContext = createContext(null);

/**
 * TaskProvider owns the global task list. It stays subscribed to the server
 * task event stream for the app's lifetime; every newly created task gets its
 * own progress stream attached automatically. Processing tasks derive the set
 * of datasets whose writes are currently locked.
 */
export function TaskProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const streamsRef = useRef(new Map());

  useEffect(() => {
    let alive = true;

    const processList = (list) => {
      if (!alive) return;
      setTasks(list);
      list.forEach((t) => {
        if (t.status === 'processing') attachStream(t.id);
      });
    };

    const attachStream = (taskId) => {
      if (streamsRef.current.has(taskId)) return;
      const es = subscribeTask(taskId, {
        onEvent: (ev) => {
          if (!alive) return;
          setTasks((prev) => prev.map((t) => (t.id === ev.id ? ev : t)));
        },
        onDone: (ev) => {
          if (!alive) return;
          setTasks((prev) => prev.map((t) => (t.id === ev.id ? ev : t)));
        },
        onError: () => {},
      });
      streamsRef.current.set(taskId, es);
    };

    fetchTasks()
      .then((res) => processList(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});

    const es = subscribeTasks({
      onSnapshot: (list) => processList(list),
      onTaskCreated: (task) => {
        if (!alive || !task || !task.id) return;
        setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
        attachStream(task.id);
      },
    });

    return () => {
      alive = false;
      es.close();
      streamsRef.current.forEach((s) => s.close());
      streamsRef.current.clear();
    };
  }, []);

  const busyDatasetIds = useMemo(
    () => new Set(tasks.filter((t) => t.status === 'processing').map((t) => t.datasetId)),
    [tasks],
  );

  const isDatasetBusy = useCallback(
    (datasetId) => busyDatasetIds.has(datasetId),
    [busyDatasetIds],
  );

  const isModelBusy = useCallback(
    (modelId) => tasks.some((t) => t.status === 'processing' && t.modelId === modelId),
    [tasks],
  );

  const value = useMemo(
    () => ({ tasks, busyDatasetIds, isDatasetBusy, isModelBusy }),
    [tasks, busyDatasetIds, isDatasetBusy, isModelBusy],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  return useContext(TaskContext);
}
