       IDENTIFICATION DIVISION.
       PROGRAM-ID. USG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 G1 USAGE COMP.
          05 A1 PIC 9(2).
          05 A2 PIC S9(9).
          05 A3 PIC 9(18).
       01 B1 PIC 9(5) COMP-5.
       01 C1 COMP-1.
       01 C2 COMP-2.
       01 P1 USAGE POINTER.
       01 I1 USAGE INDEX.
       01 S1 PIC S9(5) SIGN LEADING SEPARATE.
       01 E1 PIC -ZZ,ZZ9.99.
       01 N1 PIC N(4).
       01 R0 PIC X(10).
       01 R1 REDEFINES R0 PIC 9(10).
       01 F1 PIC X(3) VALUE 'ABC'.
          88 F1-YES VALUE 'YES'.
       01 X1 PIC 9(4) COMP-X.
       01 BC BINARY-LONG.
       01 D1.
          05 D1-N PIC 99.
          05 D1-T PIC X OCCURS 1 TO 20 DEPENDING ON D1-N.
       01 SY.
          05 SY-A PIC X.
          05 SY-B PIC S9(9) COMP SYNC.
       01 PK PIC S9(4)V99 PACKED-DECIMAL.
       01 C6 PIC 9(5) COMP-6.
       PROCEDURE DIVISION.
           MOVE 1 TO A1 SET P1 TO NULL
           IF F1-YES DISPLAY R1(1:2) END-IF
           ADD A1 TO A2 GIVING A3
           INITIALIZE G1.
       READ-X.
           GOBACK.
