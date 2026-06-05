/**
 * Predefined LeetCode problems for Problem Solve mode.
 * Each problem includes full description, examples, starter code,
 * reference solution, progressive hints, and test cases.
 */

export interface PredefinedProblem {
  id: string;
  leetcodeNumber: number;
  title: string;
  description: string;
  category: string;
  day: number;
  difficulty: string;
  language: string;
  examples: { input: string; output: string; explanation: string }[];
  starterCode: string;
  functionName: string;
  referenceSolution: string;
  hint1: string;
  hint2: string;
  hint3: string;
  testCases: { input: string; expectedOutput: string }[];
}

export const PREDEFINED_PROBLEMS: PredefinedProblem[] = [
  // ═══════════════════════════════════════
  // DAY 1 — Fundamentals
  // ═══════════════════════════════════════

  // 1. Two Sum — Arrays + Hashing
  {
    id: "two-sum",
    leetcodeNumber: 1,
    title: "Two Sum",
    description:
      "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice. You can return the answer in any order.",
    category: "Arrays + Hashing",
    day: 1,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "nums = [2,7,11,15], target = 9",
        output: "[0,1]",
        explanation: "Because nums[0] + nums[1] == 9, we return [0, 1].",
      },
      {
        input: "nums = [3,2,4], target = 6",
        output: "[1,2]",
        explanation: "Because nums[1] + nums[2] == 6, we return [1, 2].",
      },
      {
        input: "nums = [3,3], target = 6",
        output: "[0,1]",
        explanation: "Because nums[0] + nums[1] == 6, we return [0, 1].",
      },
    ],
    starterCode: `function twoSum(nums, target) {\n  // Your code here\n}`,
    functionName: "twoSum",
    referenceSolution: `function twoSum(nums, target) {\n  const map = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (map.has(complement)) {\n      return [map.get(complement), i];\n    }\n    map.set(nums[i], i);\n  }\n  return [];\n}`,
    hint1: "Think about what number you need to find for each element — the complement.",
    hint2: "A hash map can store numbers you've seen so far and their indices for O(1) lookups.",
    hint3: "Iterate through the array, check if target - nums[i] is already in the map. If yes, return both indices. If no, add nums[i] to the map.",
    testCases: [
      { input: "[2,7,11,15], 9", expectedOutput: "[0,1]" },
      { input: "[3,2,4], 6", expectedOutput: "[1,2]" },
      { input: "[3,3], 6", expectedOutput: "[0,1]" },
      { input: "[1,5,3,7], 8", expectedOutput: "[1,2]" },
    ],
  },

  // 2. Group Anagrams — Arrays + Hashing
  {
    id: "group-anagrams",
    leetcodeNumber: 49,
    title: "Group Anagrams",
    description:
      "Given an array of strings strs, group the anagrams together. You can return the answer in any order. An Anagram is a word or phrase formed by rearranging the letters of a different word or phrase, typically using all the original letters exactly once.",
    category: "Arrays + Hashing",
    day: 1,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: 'strs = ["eat","tea","tan","ate","nat","bat"]',
        output: '[["bat"],["nat","tan"],["ate","eat","tea"]]',
        explanation: 'There are three groups: anagrams of "bat", "nat"/"tan", and "ate"/"eat"/"tea".',
      },
      {
        input: 'strs = [""]',
        output: '[[""]]',
        explanation: "The only string is an empty string, which is its own group.",
      },
    ],
    starterCode: `function groupAnagrams(strs) {\n  // Your code here\n}`,
    functionName: "groupAnagrams",
    referenceSolution: `function groupAnagrams(strs) {\n  const map = new Map();\n  for (const str of strs) {\n    const key = str.split("").sort().join("");\n    if (!map.has(key)) map.set(key, []);\n    map.get(key).push(str);\n  }\n  return Array.from(map.values());\n}`,
    hint1: "Two strings are anagrams if they have the same characters in the same frequencies.",
    hint2: "Sorting each string gives a canonical form — all anagrams share the same sorted string.",
    hint3: "Use a Map where the key is the sorted string. For each word, sort it, use it as a key, and push the original word into that bucket.",
    testCases: [
      { input: '["eat","tea","tan","ate","nat","bat"]', expectedOutput: "6" },
      { input: '[""]', expectedOutput: "1" },
      { input: '["a"]', expectedOutput: "1" },
    ],
  },

  // 3. Valid Palindrome — Two Pointers
  {
    id: "valid-palindrome",
    leetcodeNumber: 125,
    title: "Valid Palindrome",
    description:
      'Given a string s, return true if it is a palindrome, or false otherwise. After converting all uppercase letters into lowercase and removing all non-alphanumeric characters.',
    category: "Two Pointers",
    day: 1,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: 's = "A man, a plan, a canal: Panama"',
        output: "true",
        explanation: '"amanaplanacanalpanama" is a palindrome.',
      },
      {
        input: 's = "race a car"',
        output: "false",
        explanation: '"raceacar" is not a palindrome.',
      },
    ],
    starterCode: `function isPalindrome(s) {\n  // Your code here\n}`,
    functionName: "isPalindrome",
    referenceSolution: `function isPalindrome(s) {\n  let left = 0, right = s.length - 1;\n  while (left < right) {\n    while (left < right && !isAlphaNum(s[left])) left++;\n    while (left < right && !isAlphaNum(s[right])) right--;\n    if (s[left].toLowerCase() !== s[right].toLowerCase()) return false;\n    left++;\n    right--;\n  }\n  return true;\n}\nfunction isAlphaNum(c) {\n  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9");\n}`,
    hint1: "A palindrome reads the same forward and backward. Can you compare characters from both ends?",
    hint2: "Use two pointers — one from the start, one from the end. Skip non-alphanumeric characters.",
    hint3: "Move left pointer past non-alphanumeric chars, same for right. Compare lowercase versions. If they don't match, return false.",
    testCases: [
      { input: '"A man, a plan, a canal: Panama"', expectedOutput: "true" },
      { input: '"race a car"', expectedOutput: "false" },
      { input: '" "', expectedOutput: "true" },
      { input: '"0P"', expectedOutput: "false" },
    ],
  },

  // 4. Two Sum II — Two Pointers
  {
    id: "two-sum-ii",
    leetcodeNumber: 167,
    title: "Two Sum II - Input Array Is Sorted",
    description:
      "Given a 1-indexed array of integers numbers that is already sorted in non-decreasing order, find two numbers such that they add up to a specific target number. Return the indices of the two numbers (1-indexed). Your solution must use only constant extra space.",
    category: "Two Pointers",
    day: 1,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "numbers = [2,7,11,15], target = 9",
        output: "[1,2]",
        explanation: "The sum of 2 and 7 is 9. Therefore index1 = 1, index2 = 2.",
      },
      {
        input: "numbers = [2,3,4], target = 6",
        output: "[1,3]",
        explanation: "The sum of 2 and 4 is 6. Therefore index1 = 1, index2 = 3.",
      },
    ],
    starterCode: `function twoSum(numbers, target) {\n  // Your code here\n}`,
    functionName: "twoSum",
    referenceSolution: `function twoSum(numbers, target) {\n  let left = 0, right = numbers.length - 1;\n  while (left < right) {\n    const sum = numbers[left] + numbers[right];\n    if (sum === target) return [left + 1, right + 1];\n    else if (sum < target) left++;\n    else right--;\n  }\n  return [];\n}`,
    hint1: "Since the array is sorted, can you exploit the ordering to avoid a hash map?",
    hint2: "Start with pointers at both ends. If the sum is too small, move the left pointer right. If too large, move the right pointer left.",
    hint3: "Two pointers: left at 0, right at end. If numbers[left] + numbers[right] < target, increment left. If > target, decrement right. Return 1-indexed positions.",
    testCases: [
      { input: "[2,7,11,15], 9", expectedOutput: "[1,2]" },
      { input: "[2,3,4], 6", expectedOutput: "[1,3]" },
      { input: "[-1,0], -1", expectedOutput: "[1,2]" },
    ],
  },

  // 5. Longest Substring Without Repeating Characters — Sliding Window
  {
    id: "longest-substring",
    leetcodeNumber: 3,
    title: "Longest Substring Without Repeating Characters",
    description:
      "Given a string s, find the length of the longest substring without repeating characters.",
    category: "Sliding Window",
    day: 1,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: 's = "abcabcbb"',
        output: "3",
        explanation: 'The answer is "abc", with the length of 3.',
      },
      {
        input: 's = "bbbbb"',
        output: "1",
        explanation: 'The answer is "b", with the length of 1.',
      },
      {
        input: 's = "pwwkew"',
        output: "3",
        explanation: 'The answer is "wke", with the length of 3.',
      },
    ],
    starterCode: `function lengthOfLongestSubstring(s) {\n  // Your code here\n}`,
    functionName: "lengthOfLongestSubstring",
    referenceSolution: `function lengthOfLongestSubstring(s) {\n  const seen = new Map();\n  let left = 0, maxLen = 0;\n  for (let right = 0; right < s.length; right++) {\n    if (seen.has(s[right]) && seen.get(s[right]) >= left) {\n      left = seen.get(s[right]) + 1;\n    }\n    seen.set(s[right], right);\n    maxLen = Math.max(maxLen, right - left + 1);\n  }\n  return maxLen;\n}`,
    hint1: "Think about maintaining a window of characters. When you see a duplicate, where should the window start?",
    hint2: "Use a sliding window with a Map to track characters in the current window. When a duplicate is found, shrink from the left.",
    hint3: "Use a Map storing the last index of each character. When s[right] was seen at an index >= left, move left to that index + 1. Update maxLen each step.",
    testCases: [
      { input: '"abcabcbb"', expectedOutput: "3" },
      { input: '"bbbbb"', expectedOutput: "1" },
      { input: '"pwwkew"', expectedOutput: "3" },
      { input: '""', expectedOutput: "0" },
    ],
  },

  // 6. Search in Rotated Sorted Array — Binary Search
  {
    id: "search-rotated",
    leetcodeNumber: 33,
    title: "Search in Rotated Sorted Array",
    description:
      "Given the array nums after the possible rotation and an integer target, return the index of target if it is in nums, or -1 if it is not in nums. You must write an algorithm with O(log n) runtime complexity. The array was originally sorted in ascending order and may have been rotated at an unknown pivot.",
    category: "Binary Search",
    day: 1,
    difficulty: "advanced",
    language: "JavaScript",
    examples: [
      {
        input: "nums = [4,5,6,7,0,1,2], target = 0",
        output: "4",
        explanation: "Target 0 is at index 4.",
      },
      {
        input: "nums = [4,5,6,7,0,1,2], target = 3",
        output: "-1",
        explanation: "Target 3 is not in the array.",
      },
    ],
    starterCode: `function search(nums, target) {\n  // Your code here\n}`,
    functionName: "search",
    referenceSolution: `function search(nums, target) {\n  let left = 0, right = nums.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (nums[mid] === target) return mid;\n    if (nums[left] <= nums[mid]) {\n      if (target >= nums[left] && target < nums[mid]) right = mid - 1;\n      else left = mid + 1;\n    } else {\n      if (target > nums[mid] && target <= nums[right]) left = mid + 1;\n      else right = mid - 1;\n    }\n  }\n  return -1;\n}`,
    hint1: "In a rotated sorted array, one half of any partition is always sorted. Can you determine which half?",
    hint2: "At each step, check if nums[left] <= nums[mid]. If so, the left half is sorted. Otherwise, the right half is sorted.",
    hint3: "Binary search: if left half is sorted and target is in [nums[left], nums[mid]), go left. Otherwise go right. If right half is sorted and target is in (nums[mid], nums[right]], go right. Otherwise go left.",
    testCases: [
      { input: "[4,5,6,7,0,1,2], 0", expectedOutput: "4" },
      { input: "[4,5,6,7,0,1,2], 3", expectedOutput: "-1" },
      { input: "[1], 0", expectedOutput: "-1" },
      { input: "[1,3], 3", expectedOutput: "1" },
    ],
  },

  // 7. Find First and Last Position — Binary Search
  {
    id: "find-first-last",
    leetcodeNumber: 34,
    title: "Find First and Last Position of Element in Sorted Array",
    description:
      "Given an array of integers nums sorted in ascending order, find the starting and ending position of a given target value. If target is not found in the array, return [-1, -1]. The algorithm must run in O(log n) time.",
    category: "Binary Search",
    day: 1,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: "nums = [5,7,7,8,8,10], target = 8",
        output: "[3,4]",
        explanation: "Target 8 appears at indices 3 and 4.",
      },
      {
        input: "nums = [5,7,7,8,8,10], target = 6",
        output: "[-1,-1]",
        explanation: "Target 6 does not exist in the array.",
      },
    ],
    starterCode: `function searchRange(nums, target) {\n  // Your code here\n}`,
    functionName: "searchRange",
    referenceSolution: `function searchRange(nums, target) {\n  function findBound(isLeft) {\n    let left = 0, right = nums.length - 1, result = -1;\n    while (left <= right) {\n      const mid = Math.floor((left + right) / 2);\n      if (nums[mid] === target) {\n        result = mid;\n        if (isLeft) right = mid - 1;\n        else left = mid + 1;\n      } else if (nums[mid] < target) left = mid + 1;\n      else right = mid - 1;\n    }\n    return result;\n  }\n  return [findBound(true), findBound(false)];\n}`,
    hint1: "You need two binary searches — one to find the leftmost occurrence and one for the rightmost.",
    hint2: "When you find target at mid, don't stop. If searching for the left bound, continue searching left (right = mid - 1). For right bound, search right.",
    hint3: "Implement a helper that takes a boolean isLeft. When nums[mid] === target, record mid as result but keep searching in the appropriate direction.",
    testCases: [
      { input: "[5,7,7,8,8,10], 8", expectedOutput: "[3,4]" },
      { input: "[5,7,7,8,8,10], 6", expectedOutput: "[-1,-1]" },
      { input: "[], 0", expectedOutput: "[-1,-1]" },
    ],
  },

  // 8. Merge Intervals — Sorting
  {
    id: "merge-intervals",
    leetcodeNumber: 56,
    title: "Merge Intervals",
    description:
      "Given an array of intervals where intervals[i] = [start_i, end_i], merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.",
    category: "Sorting",
    day: 1,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: "intervals = [[1,3],[2,6],[8,10],[15,18]]",
        output: "[[1,6],[8,10],[15,18]]",
        explanation: "Since intervals [1,3] and [2,6] overlap, merge them into [1,6].",
      },
      {
        input: "intervals = [[1,4],[4,5]]",
        output: "[[1,5]]",
        explanation: "Intervals [1,4] and [4,5] are considered overlapping.",
      },
    ],
    starterCode: `function merge(intervals) {\n  // Your code here\n}`,
    functionName: "merge",
    referenceSolution: `function merge(intervals) {\n  if (intervals.length <= 1) return intervals;\n  intervals.sort((a, b) => a[0] - b[0]);\n  const result = [intervals[0]];\n  for (let i = 1; i < intervals.length; i++) {\n    const last = result[result.length - 1];\n    if (intervals[i][0] <= last[1]) {\n      last[1] = Math.max(last[1], intervals[i][1]);\n    } else {\n      result.push(intervals[i]);\n    }\n  }\n  return result;\n}`,
    hint1: "If you sort the intervals by start time, overlapping intervals become adjacent. Then you can merge them in one pass.",
    hint2: "After sorting, maintain a result list. For each interval, if it overlaps with the last merged interval, extend the end. Otherwise, add it as a new interval.",
    hint3: "Sort by start time. Push first interval to result. For each subsequent interval: if its start <= last result interval's end, merge by updating end to max(last end, current end). Otherwise push it.",
    testCases: [
      { input: "[[1,3],[2,6],[8,10],[15,18]]", expectedOutput: "[[1,6],[8,10],[15,18]]" },
      { input: "[[1,4],[4,5]]", expectedOutput: "[[1,5]]" },
      { input: "[[1,4],[0,4]]", expectedOutput: "[[0,4]]" },
    ],
  },

  // 9. Valid Parentheses — Stack
  {
    id: "valid-parentheses",
    leetcodeNumber: 20,
    title: "Valid Parentheses",
    description:
      "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid. An input string is valid if: open brackets are closed by the same type of brackets, and open brackets are closed in the correct order. Every close bracket has a corresponding open bracket of the same type.",
    category: "Stack",
    day: 1,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: 's = "()"',
        output: "true",
        explanation: "The brackets are properly matched.",
      },
      {
        input: 's = "()[]{}"',
        output: "true",
        explanation: "All bracket types are properly matched.",
      },
      {
        input: 's = "(]"',
        output: "false",
        explanation: "The opening '(' is closed by ']', which is the wrong type.",
      },
    ],
    starterCode: `function isValid(s) {\n  // Your code here\n}`,
    functionName: "isValid",
    referenceSolution: `function isValid(s) {\n  const stack = [];\n  const map = { ")": "(", "]": "[", "}": "{" };\n  for (const char of s) {\n    if (char === "(" || char === "[" || char === "{") {\n      stack.push(char);\n    } else {\n      if (stack.pop() !== map[char]) return false;\n    }\n  }\n  return stack.length === 0;\n}`,
    hint1: "Think about using a stack. When you see an opening bracket, push it. When you see a closing bracket, what should you check?",
    hint2: "For each closing bracket, pop from the stack and verify it matches. Use a map to pair closing brackets with their opening counterparts.",
    hint3: "Push opening brackets onto a stack. For closing brackets, pop and check if the pair matches via a map {')':'(', ']':'[', '}':'{'}. At the end, the stack must be empty.",
    testCases: [
      { input: '"()"', expectedOutput: "true" },
      { input: '"()[]{}"', expectedOutput: "true" },
      { input: '"(]"', expectedOutput: "false" },
      { input: '"([)]"', expectedOutput: "false" },
      { input: '"{[]}"', expectedOutput: "true" },
    ],
  },

  // 10. Reverse Linked List — Linked List
  {
    id: "reverse-linked-list",
    leetcodeNumber: 206,
    title: "Reverse Linked List",
    description:
      "Given the head of a singly linked list, reverse the list, and return the reversed list. The list is represented by nodes with val and next properties.",
    category: "Linked List",
    day: 1,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "head = [1,2,3,4,5]",
        output: "[5,4,3,2,1]",
        explanation: "The linked list is reversed from 1→2→3→4→5 to 5→4→3→2→1.",
      },
      {
        input: "head = [1,2]",
        output: "[2,1]",
        explanation: "The list of two nodes is reversed.",
      },
    ],
    starterCode: `function reverseList(head) {\n  // head is the head node of a singly linked list\n  // Each node has .val and .next properties\n  // Return the head of the reversed list\n  // Your code here\n}`,
    functionName: "reverseList",
    referenceSolution: `function reverseList(head) {\n  let prev = null;\n  let curr = head;\n  while (curr) {\n    const next = curr.next;\n    curr.next = prev;\n    prev = curr;\n    curr = next;\n  }\n  return prev;\n}`,
    hint1: "You need to change the direction of each node's next pointer. Track the previous node as you traverse.",
    hint2: "Use three pointers: prev (initially null), curr (head), and next. At each step, reverse curr.next to point to prev, then advance.",
    hint3: "Iterate: save curr.next as nextTemp, set curr.next = prev, move prev = curr, move curr = nextTemp. Return prev when curr is null.",
    testCases: [
      { input: "[1,2,3,4,5]", expectedOutput: "[5,4,3,2,1]" },
      { input: "[1,2]", expectedOutput: "[2,1]" },
      { input: "[]", expectedOutput: "[]" },
    ],
  },

  // ═══════════════════════════════════════
  // DAY 2 — Advanced Patterns
  // ═══════════════════════════════════════

  // 11. Invert Binary Tree — Trees (DFS)
  {
    id: "invert-binary-tree",
    leetcodeNumber: 226,
    title: "Invert Binary Tree",
    description:
      "Given the root of a binary tree, invert the tree, and return its root. Inverting means swapping every left child with every right child at every node.",
    category: "Trees (DFS)",
    day: 2,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "root = [4,2,7,1,3,6,9]",
        output: "[4,7,2,9,6,3,1]",
        explanation: "The tree is inverted — left and right children of every node are swapped.",
      },
      {
        input: "root = [2,1,3]",
        output: "[2,3,1]",
        explanation: "The children of root are swapped.",
      },
    ],
    starterCode: `function invertTree(root) {\n  // root is a tree node with .val, .left, .right\n  // Your code here\n}`,
    functionName: "invertTree",
    referenceSolution: `function invertTree(root) {\n  if (!root) return null;\n  const temp = root.left;\n  root.left = root.right;\n  root.right = temp;\n  invertTree(root.left);\n  invertTree(root.right);\n  return root;\n}`,
    hint1: "What does it mean to invert a tree? For every node, swap its left and right children.",
    hint2: "This is a natural fit for recursion. Swap the children of the current node, then recursively invert both subtrees.",
    hint3: "Base case: if root is null, return null. Otherwise swap root.left and root.right using a temp variable, then call invertTree on both children. Return root.",
    testCases: [
      { input: "[4,2,7,1,3,6,9]", expectedOutput: "[4,7,2,9,6,3,1]" },
      { input: "[2,1,3]", expectedOutput: "[2,3,1]" },
      { input: "[]", expectedOutput: "[]" },
    ],
  },

  // 12. Maximum Depth of Binary Tree — Trees (DFS)
  {
    id: "max-depth",
    leetcodeNumber: 104,
    title: "Maximum Depth of Binary Tree",
    description:
      "Given the root of a binary tree, return its maximum depth. A binary tree's maximum depth is the number of nodes along the longest path from the root node down to the farthest leaf node.",
    category: "Trees (DFS)",
    day: 2,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "root = [3,9,20,null,null,15,7]",
        output: "3",
        explanation: "The longest path from root to a leaf has 3 nodes.",
      },
      {
        input: "root = [1,null,2]",
        output: "2",
        explanation: "The longest path has 2 nodes.",
      },
    ],
    starterCode: `function maxDepth(root) {\n  // root is a tree node with .val, .left, .right\n  // Your code here\n}`,
    functionName: "maxDepth",
    referenceSolution: `function maxDepth(root) {\n  if (!root) return 0;\n  return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));\n}`,
    hint1: "The depth of a tree is 1 + the maximum depth of its subtrees. What's the base case?",
    hint2: "If the root is null, depth is 0. Otherwise, it's 1 + max(depth of left subtree, depth of right subtree).",
    hint3: "Recursively: if root is null return 0. Otherwise return 1 + Math.max(maxDepth(root.left), maxDepth(root.right)).",
    testCases: [
      { input: "[3,9,20,null,null,15,7]", expectedOutput: "3" },
      { input: "[1,null,2]", expectedOutput: "2" },
      { input: "[]", expectedOutput: "0" },
    ],
  },

  // 13. Binary Tree Level Order Traversal — Trees (BFS)
  {
    id: "level-order",
    leetcodeNumber: 102,
    title: "Binary Tree Level Order Traversal",
    description:
      "Given the root of a binary tree, return the level order traversal of its nodes' values (i.e., from left to right, level by level).",
    category: "Trees (BFS)",
    day: 2,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: "root = [3,9,20,null,null,15,7]",
        output: "[[3],[9,20],[15,7]]",
        explanation: "Level 0: [3], Level 1: [9,20], Level 2: [15,7].",
      },
      {
        input: "root = [1]",
        output: "[[1]]",
        explanation: "Single node tree, just one level.",
      },
    ],
    starterCode: `function levelOrder(root) {\n  // root is a tree node with .val, .left, .right\n  // Return an array of arrays, one per level\n  // Your code here\n}`,
    functionName: "levelOrder",
    referenceSolution: `function levelOrder(root) {\n  if (!root) return [];\n  const result = [];\n  const queue = [root];\n  while (queue.length > 0) {\n    const levelSize = queue.length;\n    const level = [];\n    for (let i = 0; i < levelSize; i++) {\n      const node = queue.shift();\n      level.push(node.val);\n      if (node.left) queue.push(node.left);\n      if (node.right) queue.push(node.right);\n    }\n    result.push(level);\n  }\n  return result;\n}`,
    hint1: "Level order traversal is BFS. You need to process nodes level by level, not depth-first.",
    hint2: "Use a queue. Process all nodes at the current level, collect their values, and add their children to the queue for the next level.",
    hint3: "Initialize queue with root. While queue is not empty: record level size, shift that many nodes, collect values, push children. Each iteration produces one level array.",
    testCases: [
      { input: "[3,9,20,null,null,15,7]", expectedOutput: "[[3],[9,20],[15,7]]" },
      { input: "[1]", expectedOutput: "[[1]]" },
      { input: "[]", expectedOutput: "[]" },
    ],
  },

  // 14. Number of Islands — Graphs
  {
    id: "number-of-islands",
    leetcodeNumber: 200,
    title: "Number of Islands",
    description:
      'Given an m x n 2D binary grid which represents a map of "1"s (land) and "0"s (water), return the number of islands. An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically. You may assume all four edges of the grid are surrounded by water.',
    category: "Graphs",
    day: 2,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: 'grid = [["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]',
        output: "1",
        explanation: "There is one island formed by connected land cells.",
      },
      {
        input: 'grid = [["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]',
        output: "3",
        explanation: "There are three separate islands.",
      },
    ],
    starterCode: `function numIslands(grid) {\n  // grid is a 2D array of "1" and "0" strings\n  // Your code here\n}`,
    functionName: "numIslands",
    referenceSolution: `function numIslands(grid) {\n  if (!grid || grid.length === 0) return 0;\n  let count = 0;\n  const rows = grid.length, cols = grid[0].length;\n  function dfs(r, c) {\n    if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] !== "1") return;\n    grid[r][c] = "0";\n    dfs(r + 1, c); dfs(r - 1, c);\n    dfs(r, c + 1); dfs(r, c - 1);\n  }\n  for (let r = 0; r < rows; r++) {\n    for (let c = 0; c < cols; c++) {\n      if (grid[r][c] === "1") {\n        count++;\n        dfs(r, c);\n      }\n    }\n  }\n  return count;\n}`,
    hint1: "When you find a land cell, it's part of an island. How do you mark all connected land as visited so you don't count them again?",
    hint2: "Use DFS or BFS to flood-fill each island. When you find '1', increment count and mark all connected '1's as visited by changing them to '0'.",
    hint3: "Iterate grid. When grid[r][c] === '1', increment count and run DFS to mark all connected land as '0'. DFS explores all 4 directions. This ensures each island is counted exactly once.",
    testCases: [
      {
        input: '[["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]',
        expectedOutput: "1",
      },
      {
        input: '[["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]',
        expectedOutput: "3",
      },
      {
        input: '[["1","0"],["0","1"]]',
        expectedOutput: "2",
      },
    ],
  },

  // 15. Clone Graph — Graphs
  {
    id: "clone-graph",
    leetcodeNumber: 133,
    title: "Clone Graph",
    description:
      "Given a reference of a node in a connected undirected graph, return a deep copy (clone) of the graph. Each node has a value (int) and a list of neighbors. The graph is represented as an adjacency list.",
    category: "Graphs",
    day: 2,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: "adjList = [[2,4],[1,3],[2,4],[1,3]]",
        output: "[[2,4],[1,3],[2,4],[1,3]]",
        explanation: "The graph has 4 nodes connected as shown. The clone must be a separate object with the same structure.",
      },
      {
        input: "adjList = [[]]",
        output: "[[]]",
        explanation: "A single node with no neighbors.",
      },
    ],
    starterCode: `function cloneGraph(node) {\n  // node is a graph node with .val and .neighbors (array of nodes)\n  // Return the clone of the graph\n  // Your code here\n}`,
    functionName: "cloneGraph",
    referenceSolution: `function cloneGraph(node) {\n  if (!node) return null;\n  const visited = new Map();\n  function dfs(curr) {\n    if (visited.has(curr)) return visited.get(curr);\n    const copy = { val: curr.val, neighbors: [] };\n    visited.set(curr, copy);\n    for (const neighbor of curr.neighbors) {\n      copy.neighbors.push(dfs(neighbor));\n    }\n    return copy;\n  }\n  return dfs(node);\n}`,
    hint1: "You need to create new nodes but preserve the same structure. How do you avoid creating duplicates or infinite loops?",
    hint2: "Use a Map to track which original nodes have already been cloned. When you encounter a node you've already cloned, return the existing clone.",
    hint3: "DFS with a Map: if node is in the Map, return its clone. Otherwise create a new node, put it in the Map, then recursively clone all neighbors and add them to the new node's neighbors array.",
    testCases: [
      { input: "[[2,4],[1,3],[2,4],[1,3]]", expectedOutput: "4" },
      { input: "[[]]", expectedOutput: "1" },
    ],
  },

  // 16. Climbing Stairs — DP
  {
    id: "climbing-stairs",
    leetcodeNumber: 70,
    title: "Climbing Stairs",
    description:
      "You are climbing a staircase. It takes n steps to reach the top. Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?",
    category: "Dynamic Programming",
    day: 2,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "n = 2",
        output: "2",
        explanation: "There are two ways: 1+1 and 2.",
      },
      {
        input: "n = 3",
        output: "3",
        explanation: "There are three ways: 1+1+1, 1+2, and 2+1.",
      },
    ],
    starterCode: `function climbStairs(n) {\n  // Your code here\n}`,
    functionName: "climbStairs",
    referenceSolution: `function climbStairs(n) {\n  if (n <= 2) return n;\n  let prev2 = 1, prev1 = 2;\n  for (let i = 3; i <= n; i++) {\n    const curr = prev1 + prev2;\n    prev2 = prev1;\n    prev1 = curr;\n  }\n  return prev1;\n}`,
    hint1: "The number of ways to reach step n equals ways(n-1) + ways(n-2), since your last move was either 1 or 2 steps.",
    hint2: "This is the Fibonacci pattern. You can use two variables instead of an array to save space.",
    hint3: "Start with prev2=1 (ways to reach step 1) and prev1=2 (ways to reach step 2). For each step i from 3 to n: curr = prev1 + prev2, then shift prev2=prev1, prev1=curr. Return prev1.",
    testCases: [
      { input: "2", expectedOutput: "2" },
      { input: "3", expectedOutput: "3" },
      { input: "5", expectedOutput: "8" },
      { input: "1", expectedOutput: "1" },
    ],
  },

  // 17. Coin Change — DP
  {
    id: "coin-change",
    leetcodeNumber: 322,
    title: "Coin Change",
    description:
      "You are given an integer array coins representing coins of different denominations and an integer amount representing a total amount of money. Return the fewest number of coins that you need to make up that amount. If that amount cannot be made by any combination of the coins, return -1. You may assume that you have an infinite number of each kind of coin.",
    category: "Dynamic Programming",
    day: 2,
    difficulty: "advanced",
    language: "JavaScript",
    examples: [
      {
        input: "coins = [1,5,10,25], amount = 30",
        output: "2",
        explanation: "30 = 5 + 25, using 2 coins.",
      },
      {
        input: "coins = [2], amount = 3",
        output: "-1",
        explanation: "Cannot make 3 with only coin value 2.",
      },
      {
        input: "coins = [1], amount = 0",
        output: "0",
        explanation: "Amount 0 requires 0 coins.",
      },
    ],
    starterCode: `function coinChange(coins, amount) {\n  // Your code here\n}`,
    functionName: "coinChange",
    referenceSolution: `function coinChange(coins, amount) {\n  const dp = new Array(amount + 1).fill(Infinity);\n  dp[0] = 0;\n  for (let i = 1; i <= amount; i++) {\n    for (const coin of coins) {\n      if (coin <= i) {\n        dp[i] = Math.min(dp[i], dp[i - coin] + 1);\n      }\n    }\n  }\n  return dp[amount] === Infinity ? -1 : dp[amount];\n}`,
    hint1: "Think bottom-up: for each amount from 1 to the target, what's the minimum coins needed?",
    hint2: "Create a DP array where dp[i] = minimum coins to make amount i. For each amount, try each coin and take the minimum of dp[i - coin] + 1.",
    hint3: "Initialize dp[0] = 0 and dp[i] = Infinity for i > 0. For each i from 1 to amount, for each coin: if coin <= i, dp[i] = min(dp[i], dp[i-coin]+1). Return dp[amount] or -1 if Infinity.",
    testCases: [
      { input: "[1,5,10,25], 30", expectedOutput: "2" },
      { input: "[2], 3", expectedOutput: "-1" },
      { input: "[1], 0", expectedOutput: "0" },
      { input: "[1,2,5], 11", expectedOutput: "3" },
    ],
  },

  // 18. Jump Game — Greedy
  {
    id: "jump-game",
    leetcodeNumber: 55,
    title: "Jump Game",
    description:
      "You are given an integer array nums. You are initially positioned at the first index, and each element in the array represents your maximum jump length at that position. Return true if you can reach the last index, or false otherwise.",
    category: "Greedy",
    day: 2,
    difficulty: "intermediate",
    language: "JavaScript",
    examples: [
      {
        input: "nums = [2,3,1,1,4]",
        output: "true",
        explanation: "Jump 1 step from index 0 to 1, then 3 steps to the last index.",
      },
      {
        input: "nums = [3,2,1,0,4]",
        output: "false",
        explanation: "You will always arrive at index 3, which has a jump length of 0, making it impossible to reach the last index.",
      },
    ],
    starterCode: `function canJump(nums) {\n  // Your code here\n}`,
    functionName: "canJump",
    referenceSolution: `function canJump(nums) {\n  let maxReach = 0;\n  for (let i = 0; i < nums.length; i++) {\n    if (i > maxReach) return false;\n    maxReach = Math.max(maxReach, i + nums[i]);\n    if (maxReach >= nums.length - 1) return true;\n  }\n  return true;\n}`,
    hint1: "Track the farthest index you can reach from any position you've visited so far.",
    hint2: "Iterate through the array, maintaining maxReach = max(maxReach, i + nums[i]). If at any point i > maxReach, you're stuck — return false.",
    hint3: "Greedy: keep a maxReach variable. For each index i, if i > maxReach return false (can't get here). Update maxReach = max(maxReach, i + nums[i]). If maxReach >= last index, return true early.",
    testCases: [
      { input: "[2,3,1,1,4]", expectedOutput: "true" },
      { input: "[3,2,1,0,4]", expectedOutput: "false" },
      { input: "[0]", expectedOutput: "true" },
      { input: "[2,0,0]", expectedOutput: "true" },
    ],
  },

  // 19. Single Number — Bit Manipulation
  {
    id: "single-number",
    leetcodeNumber: 136,
    title: "Single Number",
    description:
      "Given a non-empty array of integers nums, every element appears exactly twice except for one element which appears exactly once. Find the single element that appears only once. Your solution should have O(n) time complexity and O(1) extra space.",
    category: "Bit Manipulation",
    day: 2,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "nums = [2,2,1]",
        output: "1",
        explanation: "Only 1 appears once.",
      },
      {
        input: "nums = [4,1,2,1,2]",
        output: "4",
        explanation: "Only 4 appears once.",
      },
    ],
    starterCode: `function singleNumber(nums) {\n  // Your code here\n}`,
    functionName: "singleNumber",
    referenceSolution: `function singleNumber(nums) {\n  let result = 0;\n  for (const num of nums) {\n    result ^= num;\n  }\n  return result;\n}`,
    hint1: "XOR has a special property: a ^ a = 0 and a ^ 0 = a. What happens when you XOR all numbers together?",
    hint2: "Since every number appears exactly twice except one, XORing all numbers cancels out the pairs (they become 0), leaving only the single number.",
    hint3: "Initialize result = 0, then XOR every number in the array into result. Pairs cancel out to 0, and the lone number remains. Return result.",
    testCases: [
      { input: "[2,2,1]", expectedOutput: "1" },
      { input: "[4,1,2,1,2]", expectedOutput: "4" },
      { input: "[1]", expectedOutput: "1" },
    ],
  },

  // 20. Merge Two Sorted Lists — Linked List
  {
    id: "merge-two-sorted",
    leetcodeNumber: 21,
    title: "Merge Two Sorted Lists",
    description:
      "You are given the heads of two sorted linked lists list1 and list2. Merge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists. Return the head of the merged linked list.",
    category: "Linked List",
    day: 2,
    difficulty: "beginner",
    language: "JavaScript",
    examples: [
      {
        input: "list1 = [1,2,4], list2 = [1,3,4]",
        output: "[1,1,2,3,4,4]",
        explanation: "Merging the two sorted lists produces [1,1,2,3,4,4].",
      },
      {
        input: "list1 = [], list2 = []",
        output: "[]",
        explanation: "Both empty lists produce an empty merged list.",
      },
    ],
    starterCode: `function mergeTwoLists(list1, list2) {\n  // list1 and list2 are head nodes of sorted linked lists\n  // Each node has .val and .next\n  // Return the head of the merged sorted list\n  // Your code here\n}`,
    functionName: "mergeTwoLists",
    referenceSolution: `function mergeTwoLists(list1, list2) {\n  const dummy = { val: 0, next: null };\n  let tail = dummy;\n  while (list1 && list2) {\n    if (list1.val <= list2.val) {\n      tail.next = list1;\n      list1 = list1.next;\n    } else {\n      tail.next = list2;\n      list2 = list2.next;\n    }\n    tail = tail.next;\n  }\n  tail.next = list1 || list2;\n  return dummy.next;\n}`,
    hint1: "Use a dummy node to simplify the head pointer handling. Compare the current nodes of both lists and attach the smaller one.",
    hint2: "Create a dummy node and a tail pointer. While both lists have nodes, compare and attach the smaller one to tail. Then attach the remaining list.",
    hint3: "Use a dummy head node. Maintain a tail pointer. While list1 and list2 are both non-null: if list1.val <= list2.val, set tail.next = list1 and advance list1. Else set tail.next = list2 and advance list2. Advance tail. After loop, attach remaining nodes. Return dummy.next.",
    testCases: [
      { input: "[1,2,4], [1,3,4]", expectedOutput: "[1,1,2,3,4,4]" },
      { input: "[], []", expectedOutput: "[]" },
      { input: "[], [0]", expectedOutput: "[0]" },
    ],
  },
];

/** Categories grouped by day for the syllabus sidebar */
export const PROBLEM_CATEGORIES: { day: number; label: string; categories: { name: string; problemIds: string[] }[] }[] = [
  {
    day: 1,
    label: "Day 1 — Fundamentals",
    categories: [
      { name: "Arrays + Hashing", problemIds: ["two-sum", "group-anagrams"] },
      { name: "Two Pointers", problemIds: ["valid-palindrome", "two-sum-ii"] },
      { name: "Sliding Window", problemIds: ["longest-substring"] },
      { name: "Binary Search", problemIds: ["search-rotated", "find-first-last"] },
      { name: "Sorting", problemIds: ["merge-intervals"] },
      { name: "Stack", problemIds: ["valid-parentheses"] },
      { name: "Linked List", problemIds: ["reverse-linked-list"] },
    ],
  },
  {
    day: 2,
    label: "Day 2 — Advanced Patterns",
    categories: [
      { name: "Trees (DFS)", problemIds: ["invert-binary-tree", "max-depth"] },
      { name: "Trees (BFS)", problemIds: ["level-order"] },
      { name: "Graphs", problemIds: ["number-of-islands", "clone-graph"] },
      { name: "Dynamic Programming", problemIds: ["climbing-stairs", "coin-change"] },
      { name: "Greedy", problemIds: ["jump-game"] },
      { name: "Bit Manipulation", problemIds: ["single-number"] },
      { name: "Linked List", problemIds: ["merge-two-sorted"] },
    ],
  },
];

export function getProblemsByDay(day: number): PredefinedProblem[] {
  return PREDEFINED_PROBLEMS.filter((p) => p.day === day);
}

export function getProblemsByCategory(category: string): PredefinedProblem[] {
  return PREDEFINED_PROBLEMS.filter((p) => p.category === category);
}

export function getProblemById(id: string): PredefinedProblem | undefined {
  return PREDEFINED_PROBLEMS.find((p) => p.id === id);
}
