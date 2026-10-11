import { View, Text, StyleSheet } from 'react-native';

export default function InterviewScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Interview</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 24,
    color: '#333',
  },
});