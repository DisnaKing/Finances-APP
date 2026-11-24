import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons, useTheme } from 'react-native-paper';
import { AnnualView } from '@/src/components/AnnualView';
import { TotalView } from '@/src/components/TotalView';

export default function Totales() {
  const c = useTheme().colors;
  const [tab, setTab] = useState<'anual' | 'total'>('anual');
  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <SegmentedButtons
        style={styles.tabs}
        value={tab}
        onValueChange={(v) => setTab(v as 'anual' | 'total')}
        buttons={[
          { value: 'anual', label: 'Anual', icon: 'calendar-month' },
          { value: 'total', label: 'Total', icon: 'sigma' },
        ]}
      />
      {tab === 'anual' ? <AnnualView /> : <TotalView />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { marginHorizontal: 16, marginTop: 12 },
});
