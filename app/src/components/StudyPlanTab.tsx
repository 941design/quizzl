import React, { useState } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Checkbox,
  Progress,
  Heading,
  Button,
  Collapse,
  Divider,
  Badge,
} from '@chakra-ui/react';
import type { StudyPlan, StudyTask } from '@/src/types';
import { useCopy } from '@/src/context/LanguageContext';
import { useThemeStyles } from '@/src/hooks/useThemeStyles';
import ThemeIcon from '@/src/components/ThemeIcon';

type StudyPlanTabProps = {
  studyPlan: StudyPlan;
  completedTaskIds: string[];
  onToggleTask: (taskId: string) => void;
};

function getTaskIconName(task: StudyTask): string {
  switch (task.type) {
    case 'quiz':
      return 'quiz';
    case 'flashcards':
      return 'flashcard';
    case 'notes':
      return 'notes';
    case 'custom':
    default:
      return 'task';
  }
}

type StepProps = {
  step: StudyPlan['steps'][0];
  completedTaskIds: string[];
  onToggleTask: (taskId: string) => void;
  defaultExpanded?: boolean;
};

function StudyStep({ step, completedTaskIds, onToggleTask, defaultExpanded = true }: StepProps) {
  const copy = useCopy();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const completedCount = step.tasks.filter((t) => completedTaskIds.includes(t.id)).length;
  const totalTasks = step.tasks.length;
  const isComplete = completedCount === totalTasks && totalTasks > 0;
  const progressPercent = totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0;

  return (
    <Box
      borderWidth="1px"
      borderColor={isComplete ? 'brand.300' : 'borderSubtle'}
      borderRadius="lg"
      overflow="hidden"
      transition="border-color 0.2s"
      data-testid={`study-step-${step.id}`}
    >
      {/* Step Header */}
      <Button
        w="100%"
        variant="ghost"
        onClick={() => setExpanded((e) => !e)}
        p={4}
        borderRadius={0}
        justifyContent="space-between"
        aria-expanded={expanded}
        aria-controls={`step-content-${step.id}`}
        bg={isComplete ? 'surfaceMutedBg' : 'surfaceRaisedBg'}
        _hover={{ bg: 'surfaceMutedBg' }}
      >
        <HStack flex="1" spacing={3}>
          {isComplete && (
            <Badge variant="solid" fontSize="xs">
              {copy.studyPlan.done}
            </Badge>
          )}
          <Box textAlign="left">
            <Text fontWeight="semibold">{step.title}</Text>
            {step.description && (
              <Text fontSize="sm" color="textMuted" fontWeight="normal">
                {step.description}
              </Text>
            )}
          </Box>
        </HStack>
        <HStack spacing={3} ml={4}>
          <Text fontSize="sm" color="textMuted" flexShrink={0}>
            {completedCount}/{totalTasks}
          </Text>
          <Text fontSize="xs" color="textMuted">
            {expanded ? '▲' : '▼'}
          </Text>
        </HStack>
      </Button>

      {/* Progress bar */}
      <Progress
        value={progressPercent}
        size="xs"
        borderRadius={0}
      />

      {/* Tasks */}
      <Collapse in={expanded} id={`step-content-${step.id}`}>
        <VStack spacing={0} align="stretch" divider={<Divider />}>
          {step.tasks.map((task) => {
            const isTaskDone = completedTaskIds.includes(task.id);
            return (
              <HStack
                key={task.id}
                p={3}
                spacing={3}
                bg={isTaskDone ? 'surfaceMutedBg' : 'surfaceBg'}
                transition="background-color 0.15s"
                data-testid={`task-item-${task.id}`}
              >
                <Checkbox
                  isChecked={isTaskDone}
                  onChange={() => onToggleTask(task.id)}
                  aria-label={copy.studyPlan.completeTask(task.title)}
                  data-testid={`task-checkbox-${task.id}`}
                />
                <ThemeIcon
                  name={getTaskIconName(task)}
                  size={16}
                  color={isTaskDone ? 'var(--chakra-colors-neutral-400)' : 'var(--chakra-colors-brand-500)'}
                />
                <Text
                  fontSize="sm"
                  textDecoration={isTaskDone ? 'line-through' : 'none'}
                  color={isTaskDone ? 'textMuted' : 'textStrong'}
                  flex="1"
                >
                  {task.title}
                </Text>
              </HStack>
            );
          })}
        </VStack>
      </Collapse>
    </Box>
  );
}

export default function StudyPlanTab({
  studyPlan,
  completedTaskIds,
  onToggleTask,
}: StudyPlanTabProps) {
  const copy = useCopy();
  if (!studyPlan || studyPlan.steps.length === 0) {
    return (
      <Box py={8} textAlign="center" data-testid="study-plan-empty">
        <Text color="textMuted" fontSize="lg">
          {copy.studyPlan.emptyHeading}
        </Text>
        <Text color="textMuted" mt={2}>
          {copy.studyPlan.emptyBody}
        </Text>
      </Box>
    );
  }

  const allTasks = studyPlan.steps.flatMap((s) => s.tasks);
  const totalCompleted = allTasks.filter((t) => completedTaskIds.includes(t.id)).length;
  const totalTasks = allTasks.length;

  return (
    <Box data-testid="study-plan-container">
      {/* Overall progress */}
      <HStack justify="space-between" mb={2}>
        <Text fontSize="sm" color="textMuted">
          {copy.studyPlan.overallProgress}
        </Text>
        <Text fontSize="sm" fontWeight="semibold" color="brand.600">
          {copy.studyPlan.tasksCompleted(totalCompleted, totalTasks)}
        </Text>
      </HStack>
      <Progress
        value={(totalCompleted / Math.max(totalTasks, 1)) * 100}
        borderRadius="full"
        size="sm"
        mb={6}
        data-testid="plan-progress"
      />

      {/* Steps */}
      <VStack spacing={4} align="stretch">
        {studyPlan.steps.map((step, idx) => (
          <StudyStep
            key={step.id}
            step={step}
            completedTaskIds={completedTaskIds}
            onToggleTask={onToggleTask}
            defaultExpanded={idx === 0}
          />
        ))}
      </VStack>
    </Box>
  );
}
