       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTWIDE.
      * A 20-digit item needs ARITH(EXTEND), which carries 31 digits.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A       PIC S9(20) COMP-3.
       01 WS-B       PIC S9(11) COMP-3.
       01 WS-C       PIC S9(12) COMP-3.
       01 WS-R       PIC S9(31) COMP-3.
       PROCEDURE DIVISION.
           COMPUTE WS-R = WS-A * WS-B
           COMPUTE WS-R = WS-A * WS-C
           GOBACK.
